package com.homaklab.cast.cast

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.homaklab.cast.Branding
import com.homaklab.cast.MainActivity
import com.homaklab.cast.R
import com.homaklab.cast.audio.SystemAudioCapture

/**
 * Foreground service (type mediaProjection) that owns the [CastSession]. Android only allows screen capture
 * while such a service is running, and it must call startForeground() before the projection is used.
 */
class CastService : Service(), CastSession.Events {

    private var session: CastSession? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                session?.stop() ?: stopSelf()
            }
            ACTION_START -> startCast(intent)
            else -> stopSelf()
        }
        return START_NOT_STICKY
    }

    private fun startCast(intent: Intent) {
        if (session != null) return
        // Audio needs Android 10+ and RECORD_AUDIO; the foreground service must declare the microphone type for it.
        val captureAudio = intent.getBooleanExtra(EXTRA_AUDIO, false) &&
            SystemAudioCapture.isSupported && SystemAudioCapture.hasPermission(this)
        enterForeground(getString(R.string.notif_connecting), captureAudio)

        val projectionData = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra(EXTRA_PROJECTION_DATA, Intent::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra(EXTRA_PROJECTION_DATA)
        }
        val server = intent.getStringExtra(EXTRA_SERVER)
        val pin = intent.getStringExtra(EXTRA_PIN)
        if (projectionData == null || server == null || pin == null) {
            CastState.publish(CastStatus.Failed(getString(R.string.err_missing_params)))
            stopSelf()
            return
        }

        // Must happen after startForeground(); the projection is shared by video and audio capture.
        val projection = try {
            getSystemService(MediaProjectionManager::class.java).getMediaProjection(Activity.RESULT_OK, projectionData)
        } catch (e: SecurityException) {
            CastState.publish(CastStatus.Failed(getString(R.string.err_projection_denied)))
            stopSelf()
            return
        }

        val company = Branding.normalize(getSharedPreferences("cast", MODE_PRIVATE).getString("company", null))
        session = CastSession(
            context = this,
            projection = projection,
            captureAudio = captureAudio,
            serverUrl = server,
            pin = pin,
            requestedFps = intent.getIntExtra(EXTRA_FPS, 30),
            deviceName = Branding.deviceLabel(company, "${Build.MANUFACTURER} ${Build.MODEL}"),
            model = Branding.deviceLabel(company, Build.MODEL),
            events = this
        ).also { it.start() }
    }

    override fun onStatus(status: CastStatus) {
        CastState.publish(status)
        val text = when (status) {
            is CastStatus.Streaming -> getString(R.string.notif_streaming, status.resolution, status.fps, audioLabel(status.audio))
            is CastStatus.WaitingApproval -> getString(R.string.status_waiting_approval)
            else -> getString(R.string.notif_connecting)
        }
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, buildNotification(text))
    }

    override fun onFinished(reason: String?) {
        session = null
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        session?.stop()
        session = null
        super.onDestroy()
    }

    private fun audioLabel(on: Boolean): String = getString(if (on) R.string.audio_on else R.string.audio_off)

    private fun enterForeground(text: String, withMicrophone: Boolean) {
        val notification = buildNotification(text)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            var type = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
            if (withMicrophone && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
            }
            startForeground(NOTIFICATION_ID, notification, type)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun buildNotification(text: String): Notification {
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm.getNotificationChannel(CHANNEL_ID) == null) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, getString(R.string.notif_channel), NotificationManager.IMPORTANCE_LOW)
            )
        }
        val openApp = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val stop = PendingIntent.getService(
            this, 1, Intent(this, CastService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_cast_notification)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(text)
            .setContentIntent(openApp)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .addAction(0, getString(R.string.action_stop), stop)
            .build()
    }

    companion object {
        const val ACTION_START = "com.homaklab.cast.START"
        const val ACTION_STOP = "com.homaklab.cast.STOP"
        const val EXTRA_PROJECTION_DATA = "projection_data"
        const val EXTRA_SERVER = "server"
        const val EXTRA_PIN = "pin"
        const val EXTRA_FPS = "fps"
        const val EXTRA_AUDIO = "audio"
        private const val CHANNEL_ID = "cast"
        private const val NOTIFICATION_ID = 1
    }
}
