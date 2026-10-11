package com.genzo.android

data class PlaybackFailure(val code: String, val message: String, val retryable: Boolean = true) {
    companion object {
        fun from(code: String) = when (code) {
            "credential_invalid" -> PlaybackFailure(code, "来源认证失败或播放地址已过期，请返回来源重新获取视频。", false)
            "permission_denied" -> PlaybackFailure(code, "无法读取视频，请返回资料库重新授权或检查来源权限。", false)
            "source_missing" -> PlaybackFailure(code, "视频地址不存在或已失效，请返回选集重新获取地址。", false)
            "source_offline" -> PlaybackFailure(code, "视频连接中断，请检查网络后重试；规则视频可返回选集切换线路。")
            "network_timeout" -> PlaybackFailure(code, "视频连接或缓冲超时，请检查网络后重试。")
            "resolve_failed" -> PlaybackFailure(code, "未能获取播放地址，请返回选集重试或切换线路。", false)
            "unsupported_media" -> PlaybackFailure(code, "当前内容不是可识别的视频，或其格式不受支持，请换线路或文件。", false)
            "decode_failed" -> PlaybackFailure(code, "视频解码失败，可在“我的 → 播放设置”关闭硬件解码后重试。")
            "render_failed" -> PlaybackFailure(code, "画面初始化失败，可选择 OpenGL 并关闭超分后重试。")
            "audio_failed" -> PlaybackFailure(code, "音频输出初始化失败，请检查设备音频状态后重试。")
            "player_unavailable" -> PlaybackFailure(code, "播放组件无法加载，请更新或重新安装应用。", false)
            "file_unavailable" -> PlaybackFailure(code, "视频无法读取，请检查文件是否仍在原位置及来源是否可用。", false)
            else -> PlaybackFailure("playback_failed", "视频播放失败，请重试；规则视频可返回选集切换线路。")
        }
    }
}

data class PlaybackRecovery(val renderer: String, val mode: Int, val software: Boolean, val message: String)

// Recovery applies to this playback attempt only; stored user preferences stay intact.
fun nextPlaybackRecovery(code: String, renderer: String, mode: Int, hardware: Boolean, tried: Set<String>): PlaybackRecovery? = when {
    code == "render_failed" && mode > 0 && "no-shaders" !in tried -> PlaybackRecovery(renderer, 0, !hardware, "画面处理失败，本次已关闭超分")
    code == "render_failed" && renderer != "gpu" && "opengl" !in tried -> PlaybackRecovery("gpu", mode, !hardware, "当前渲染器不可用，本次已切换 OpenGL")
    code == "decode_failed" && hardware && "software" !in tried -> PlaybackRecovery(if (renderer == "mediacodec_embed") "gpu" else renderer, mode, true, "硬件解码失败，本次已切换软件解码")
    else -> null
}
