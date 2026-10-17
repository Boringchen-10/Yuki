package com.genzo.android

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.media3.exoplayer.offline.Download
import androidx.media3.exoplayer.offline.DownloadManager
import androidx.media3.exoplayer.offline.DownloadService
import androidx.media3.exoplayer.scheduler.PlatformScheduler
import androidx.media3.exoplayer.scheduler.Scheduler

class VideoDownloadService : DownloadService(5407, 1000L) {
    override fun onCreate() { downloadChannel(this); super.onCreate() }
    override fun getDownloadManager(): DownloadManager = OfflineVideoDownloads.get(this).manager
    override fun getScheduler(): Scheduler = PlatformScheduler(this, 5409)
    override fun getForegroundNotification(downloads: MutableList<Download>, notMetRequirements: Int): Notification {
        val active = downloads.count { it.state == Download.STATE_DOWNLOADING }
        val text = if (notMetRequirements != 0) "等待网络连接" else "正在下载 $active 个视频"
        return downloadNotification(this, "Yuki 下载中心", text)
    }
    override fun onTimeout(startId: Int, fgsType: Int) {
        val manager = OfflineVideoDownloads.get(this).manager
        manager.currentDownloads.filter { it.state in listOf(Download.STATE_QUEUED, Download.STATE_DOWNLOADING) }.forEach { manager.setStopReason(it.request.id, 2) }
        manager.pauseDownloads()
        stopForeground(STOP_FOREGROUND_REMOVE); stopSelf()
    }
}

/** Rust retains chapter task state; this service only keeps its active worker eligible in the background. */
class BookDownloadService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onCreate() { super.onCreate(); downloadChannel(this) }
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        stopped = false
        val count = intent?.getIntExtra("count", 1)?.coerceAtLeast(1) ?: 1
        val notification = downloadNotification(this, "Yuki 下载中心", "正在下载 $count 个书籍任务")
        if (Build.VERSION.SDK_INT >= 29) startForeground(5408, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        else startForeground(5408, notification)
        return START_NOT_STICKY
    }
    override fun onTimeout(startId: Int, fgsType: Int) { stopped = true; stopForeground(STOP_FOREGROUND_REMOVE); stopSelf() }
    override fun onDestroy() { stopped = true; super.onDestroy() }
    companion object { @Volatile var stopped = true }
}

private const val DOWNLOAD_CHANNEL = "genzo-downloads"
private fun downloadChannel(context: Context) {
    context.getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel(DOWNLOAD_CHANNEL, "下载中心", NotificationManager.IMPORTANCE_LOW))
}
private fun downloadNotification(context: Context, title: String, text: String): Notification {
    val notification = NotificationCompat.Builder(context, DOWNLOAD_CHANNEL).setSmallIcon(android.R.drawable.stat_sys_download)
        .setContentTitle(title).setContentText(text).setOngoing(true).setOnlyAlertOnce(true).setSilent(true)
    context.packageManager.getLaunchIntentForPackage(context.packageName)?.let { open ->
        notification.setContentIntent(PendingIntent.getActivity(context, 5407, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
    }
    return notification.build()
}
