package com.homaklab.cast

import android.app.Application

class CastApp : Application() {
    override fun onCreate() {
        super.onCreate()
        ErrorReport.install(this)
        DebugLog.add("Uygulama başladı")
    }
}
