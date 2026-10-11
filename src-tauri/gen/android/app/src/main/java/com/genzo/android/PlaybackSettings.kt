package com.genzo.android

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build

// Android choices / coupling adapted from Kazumi (GPLv3), commit 2768c230.
// Keep the prior renderer on upgrade; the user can explicitly select Kazumi's Auto.
data class PlaybackSettings(val hardware: Boolean = true, val decoder: String = "auto-safe", val renderer: String = "compat") {
    companion object {
        val decoders = linkedMapOf("auto-safe" to "自动安全", "auto" to "自动", "auto-copy" to "自动拷贝", "mediacodec" to "MediaCodec", "mediacodec-copy" to "MediaCodec 拷贝")
        val renderers = linkedMapOf("compat" to "兼容播放 · LibVLC", "auto" to "自动 · 按安卓能力选择", "gpu" to "OpenGL · GPU", "gpu-next" to "Vulkan · GPU Next", "mediacodec_embed" to "低功耗直通 · 无超分与字幕")
        fun read(context: Context): PlaybackSettings {
            val prefs = context.getSharedPreferences("genzo-player", 0)
            return PlaybackSettings(prefs.getBoolean("hardwareDecoding", true), prefs.getString("hardwareDecoder", "auto-safe").takeIf { it in decoders } ?: "auto-safe", prefs.getString("videoRenderer", "compat").takeIf { it in renderers } ?: "compat")
        }
    }
    fun save(context: Context) {
        require(decoder in decoders && renderer in renderers && (renderer != "mediacodec_embed" || hardware))
        context.getSharedPreferences("genzo-player", 0).edit().putBoolean("hardwareDecoding", hardware).putString("hardwareDecoder", decoder).putString("videoRenderer", renderer).apply()
    }
    fun resolve(context: Context, superResolution: Int): String = when (renderer) {
        "compat" -> if (superResolution > 0) "gpu" else "compat"
        "auto" -> if (Build.VERSION.SDK_INT >= 34 && context.packageManager.hasSystemFeature(PackageManager.FEATURE_VULKAN_HARDWARE_VERSION, 0x00402000)) "gpu-next" else "gpu"
        else -> renderer
    }
}
