package com.genzo.android

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Handler
import android.os.Looper
import org.json.JSONObject

internal fun downloadNetworkAllowed(onlyWifi: Boolean, wifi: Boolean, cellular: Boolean) = !onlyWifi || wifi && !cellular

/** One local policy for video, book and file downloads, including VPN transport changes. */
internal object DownloadNetwork {
    @Volatile private var wifi = false
    @Volatile private var cellular = false
    private var installed = false
    fun onlyWifi(context: Context) = context.getSharedPreferences("genzo-download-storage", 0).getBoolean("wifiOnly", false)
    @Synchronized fun initialize(context: Context) {
        if (installed) return
        val app = context.applicationContext
        val manager = app.getSystemService(ConnectivityManager::class.java)
        val handler = Handler(Looper.getMainLooper())
        fun refresh() {
            val capabilities = manager.getNetworkCapabilities(manager.activeNetwork)
            wifi = capabilities?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true
            cellular = capabilities?.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) == true
            OfflineVideoDownloads.refreshNetwork()
        }
        refresh()
        manager.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) { handler.post { refresh() } }
            override fun onLost(network: Network) { handler.post { refresh() } }
            override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) { handler.post { refresh() } }
        })
        installed = true
    }
    fun allowed(context: Context): Boolean { initialize(context); return downloadNetworkAllowed(onlyWifi(context), wifi, cellular) }
    fun requireAllowed(context: Context) { if (!allowed(context)) throw OfflineDownloadException("offline_waiting_wifi") }
    fun state(context: Context) = JSONObject().put("wifiOnly", onlyWifi(context)).put("allowed", allowed(context))
}
