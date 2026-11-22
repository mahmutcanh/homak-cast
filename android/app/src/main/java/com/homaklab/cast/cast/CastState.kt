package com.homaklab.cast.cast

import android.os.Handler
import android.os.Looper

/** What the UI shows. Plain Turkish text is produced by the UI layer, details are carried here. */
sealed class CastStatus {
    object Idle : CastStatus()
    object Connecting : CastStatus()
    object WaitingApproval : CastStatus()
    data class Streaming(val resolution: String, val fps: Int) : CastStatus()
    data class Ended(val reason: String) : CastStatus()
    data class Failed(val message: String) : CastStatus()
}

/** Tiny main-thread state bus between [CastService] and the activity (no extra dependencies). */
object CastState {
    private val main = Handler(Looper.getMainLooper())

    @Volatile
    var current: CastStatus = CastStatus.Idle
        private set

    private var observer: ((CastStatus) -> Unit)? = null

    fun publish(status: CastStatus) {
        current = status
        main.post { observer?.invoke(status) }
    }

    fun observe(callback: ((CastStatus) -> Unit)?) {
        observer = callback
        if (callback != null) main.post { callback(current) }
    }

    val isActive: Boolean
        get() = current is CastStatus.Connecting ||
            current is CastStatus.WaitingApproval ||
            current is CastStatus.Streaming
}
