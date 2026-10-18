package com.genzo.android

import android.content.Context
import android.os.Environment
import android.os.StatFs
import android.os.storage.StorageManager
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID

/** Only Android-provided app directories can become download roots. */
internal object DownloadStorage {
    data class Location(val id: String, val label: String, val root: File, val parent: File)
    fun locations(context: Context): List<Location> {
        val manager = context.getSystemService(StorageManager::class.java)
        return listOf(Location("internal", "应用内部存储", context.dataDir, context.dataDir)) + context.getExternalFilesDirs(null).filterNotNull().mapNotNull { parent ->
            if (Environment.getExternalStorageState(parent) != Environment.MEDIA_MOUNTED) return@mapNotNull null
            val volume = manager.getStorageVolume(parent)
            val id = "external:${volume?.uuid ?: "primary"}"
            Location(id, if (volume?.isRemovable == true) "SD 卡 · ${volume.getDescription(context)}" else "手机存储（应用专属目录）", File(parent, "YukiDownloads"), parent)
        }.distinctBy { it.id }
    }
    fun selectedId(context: Context): String = context.getSharedPreferences("genzo-download-storage", 0).getString("selected", "internal") ?: "internal"
    fun readingArchive(context: Context, raw: String): File {
        val file = File(raw).canonicalFile
        require(locations(context).any { file.path.startsWith(File(it.root, "reading-cache").canonicalPath + "/") }) { "阅读文件不属于应用下载目录" }
        return file
    }
    fun root(context: Context, id: String, create: Boolean = false): File {
        val location = locations(context).firstOrNull { it.id == id } ?: throw OfflineDownloadException("offline_storage_unavailable")
        if (create) check(location.root.isDirectory || location.root.mkdirs()) { "无法创建下载目录，请检查可用空间" }
        return location.root
    }
    fun state(context: Context): JSONObject {
        val selected = selectedId(context)
        val choices = locations(context)
        return JSONObject().put("selected", selected).put("wifiOnly", DownloadNetwork.onlyWifi(context)).put("available", choices.any { it.id == selected }).put("locations", JSONArray().apply {
            choices.forEach { location -> put(JSONObject().put("id", location.id).put("label", location.label)
                .put("path", location.root.absolutePath).put("freeBytes", runCatching { StatFs(location.parent.path).availableBytes }.getOrDefault(0))) }
        })
    }
    fun select(context: Context, id: String, wifiOnly: Boolean? = null): JSONObject {
        val root = root(context, id, true)
        val probe = File(root, ".yuki-write-${UUID.randomUUID()}")
        try { probe.outputStream().use { it.write(0) } } finally { probe.delete() }
        val editor = context.getSharedPreferences("genzo-download-storage", 0).edit().putString("selected", id)
        if (wifiOnly != null) editor.putBoolean("wifiOnly", wifiOnly)
        check(editor.commit()) { "下载设置保存失败，请重试" }
        DownloadNetwork.initialize(context); OfflineVideoDownloads.refreshNetwork()
        return state(context)
    }
}
