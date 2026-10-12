package com.genzo.android

import android.content.Context
import android.os.ParcelFileDescriptor
import android.view.Surface
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.View
import java.io.File

data class VideoTrack(val id: Int, val name: String)

// Shared controls retain the current Activity/session ownership.
interface VideoEngine {
    val view: View
    val name: String
    val isPlaying: Boolean
    val time: Long
    val length: Long
    val isSeekable: Boolean
    var rate: Float
    val audioTracks: Array<VideoTrack>
    val spuTracks: Array<VideoTrack>
    val audioTrack: Int
    val spuTrack: Int
    val spuDelay: Long
    fun open(uri: String, descriptor: ParcelFileDescriptor?, position: Long, paused: Boolean)
    fun play()
    fun pause()
    fun setTime(time: Long, fast: Boolean = false)
    fun setAudioTrack(id: Int): Boolean
    fun setSpuTrack(id: Int): Boolean
    fun setSpuDelay(delay: Long): Boolean
    fun addSubtitle(path: String): Boolean
    fun onStart() {}
    fun onStop() {}
    fun poll() {}
    fun release()
}

// Handle-based JNI facade; ordinary playback and Anime4K use the same libmpv.
object MpvNative {
    init { System.loadLibrary("mpv"); System.loadLibrary("genzompv") }
    external fun create(): Long
    external fun option(handle: Long, key: String, value: String): Int
    external fun init(handle: Long): Int
    external fun command(handle: Long, args: Array<String>): Int
    external fun commandAsync(handle: Long, args: Array<String>): Int
    external fun get(handle: Long, key: String): String?
    external fun set(handle: Long, key: String, value: String): Int
    external fun surface(handle: Long, surface: Surface?): Int
    external fun poll(handle: Long): Int
    external fun problem(handle: Long): Int
    external fun destroy(handle: Long)
}

class MpvEngine(private val context: Context, mode: Int, private val state: (String, String?) -> Unit, settings: PlaybackSettings, val renderer: String) : VideoEngine, SurfaceHolder.Callback {
    override val view = SurfaceView(context)
    private var requestedMode = mode
    val instanceId = java.util.UUID.randomUUID().toString()
    override val name get() = if (requestedMode > 0) "libmpv · Anime4K" else "libmpv"
    private val budget = Anime4kBudget()
    var effectiveMode = 0; private set
    val performanceReason get() = budget.reason ?: if (requestedMode > 0 && effectiveMode == 0 && loaded) "原视频分辨率已高于显示区域，无需超分放大" else null
    private var configured = false
    private var lastBudgetAt = 0L
    private var outputWidth = 0
    private var outputHeight = 0
    var gpuTimeMs = 0.0; private set
    var shaderPasses = org.json.JSONArray(); private set
    private var handle = MpvNative.create().also { check(it != 0L) }
    private var opened = false
    private var loaded = false
    private var frameRendered = false
    private var ended = false
    private var pending: (() -> Unit)? = null
    private var lastStatus = "opening"
    private var firstFrameAt = 0L
    private var attached = false
    private var foreground = true
    private var bufferingSince = 0L
    private var terminalFailure = false
    private var networkSource = false
    private var pendingEvents = 0
    var shaderFiles = emptyList<String>(); private set
    fun property(key: String) = if (handle != 0L) MpvNative.get(handle, key) else null
    private fun number(key: String) = property(key)?.toDoubleOrNull() ?: 0.0
    private fun flag(key: String) = property(key) == "yes"
    private fun set(key: String, value: String): Boolean = handle != 0L && MpvNative.set(handle, key, value) >= 0
    private fun command(vararg args: String) = handle != 0L && MpvNative.command(handle, arrayOf(*args)) >= 0
    override val isPlaying get() = loaded && !ended && !flag("pause") && !flag("paused-for-cache")
    override val time get() = (number("time-pos") * 1000).toLong()
    override val length get() = (number("duration") * 1000).toLong()
    override val isSeekable get() = flag("seekable")
    override var rate: Float
        get() = number("speed").toFloat().takeIf { it > 0 } ?: 1f
        set(value) { check(set("speed", value.toString())) }
    private fun tracks(type: String) = buildList {
        add(VideoTrack(-1, "关闭"))
        repeat(number("track-list/count").toInt().coerceIn(0, 128)) { index ->
            val prefix = "track-list/$index"
            if (property("$prefix/type") == type) {
                val id = property("$prefix/id")?.toIntOrNull() ?: return@repeat
                val label = property("$prefix/title") ?: property("$prefix/lang") ?: "$type $id"
                add(VideoTrack(id, label))
            }
        }
    }.toTypedArray()
    override val audioTracks get() = tracks("audio")
    override val spuTracks get() = tracks("sub")
    override val audioTrack get() = property("aid")?.toIntOrNull() ?: -1
    override val spuTrack get() = property("sid")?.toIntOrNull() ?: -1
    override val spuDelay get() = (number("sub-delay") * 1_000_000).toLong()
    init {
        try {
            val options = mapOf(
                "config" to "no",
                "vo" to renderer,
                "gpu-api" to if (renderer == "gpu-next") "vulkan" else "opengl",
                "gpu-context" to if (renderer == "gpu-next") "androidvk" else "android",
                "opengl-es" to "yes",
                "hwdec" to if (renderer == "mediacodec_embed") "mediacodec" else if (!settings.hardware) "no" else if (renderer == "gpu-next" && settings.decoder == "mediacodec") "mediacodec-copy" else settings.decoder,
                "ao" to "audiotrack,opensles",
                "idle" to "yes",
                "keep-open" to "yes",
                "force-window" to "no",
                "terminal" to "no",
                "input-default-bindings" to "no",
                "cache" to "yes",
                "network-timeout" to "15",
                "demuxer-max-bytes" to "67108864",
                "demuxer-max-back-bytes" to "16777216",
                "glsl-shaders" to "",
                "gpu-shader-cache-dir" to File(context.cacheDir,"mpv-shaders").absolutePath
            )
            // This LGPL build has no fontconfig. Reuse a few readable Android fonts,
            // rather than bundling fonts or loading the whole system font directory.
            val fonts = File(context.cacheDir, "mpv-fonts").apply { mkdirs() }
            val systemFonts = File("/system/fonts").listFiles()?.toList() ?: emptyList()
            val latin = systemFonts.firstOrNull { it.name == "Roboto-Regular.ttf" } ?: systemFonts.firstOrNull { it.name == "NotoSans-Regular.ttf" }
            val cjk = systemFonts.firstOrNull { it.name == "NotoSansCJK-Regular.ttc" } ?: systemFonts.firstOrNull { it.name.startsWith("NotoSansCJK") && !it.name.contains("Bold") }
            val availableFonts = listOfNotNull(latin, cjk).filter { it.canRead() }
            check(availableFonts.isNotEmpty()) { "No readable system subtitle font" }
            availableFonts.forEach { font ->
                val link = File(fonts, font.name)
                if (!link.exists()) { link.delete(); android.system.Os.symlink(font.absolutePath, link.absolutePath) }
            }
            check(MpvNative.option(handle, "sub-fonts-dir", fonts.absolutePath) >= 0)
            check(MpvNative.option(handle, "sub-font", if (cjk != null) "Noto Sans CJK SC" else "Roboto") >= 0)
            options.forEach { (key, value) -> check(MpvNative.option(handle, key, value) >= 0) { "Unsupported mpv option: $key" } }
            if (renderer == "mediacodec_embed") check(MpvNative.option(handle, "sid", "no") >= 0)
            check(MpvNative.init(handle) >= 0)
            view.holder.addCallback(this)
        } catch (error: Throwable) { android.util.Log.w("GenzoAnime4K", "GPU initialization failed", error); MpvNative.destroy(handle); handle = 0; throw error }
    }
    private fun shaderPaths(mode: Int): List<String> {
        val names = when (mode) {
            2 -> listOf("Clamp_Highlights", "Restore_CNN_VL", "Upscale_CNN_x2_VL", "AutoDownscalePre_x2", "AutoDownscalePre_x4", "Upscale_CNN_x2_M")
            1 -> listOf("Clamp_Highlights", "Restore_CNN_M", "Upscale_CNN_x2_M", "AutoDownscalePre_x2", "AutoDownscalePre_x4", "Upscale_CNN_x2_S")
            else -> emptyList()
        }
        val directory = File(context.filesDir, "anime4k/7684e958").apply { mkdirs() }
        return names.map { "Anime4K_$it.glsl" }.map { name ->
            val file = File(directory, name)
            if (!file.isFile || file.length() == 0L) context.assets.open("anime4k/$name").use { input -> file.outputStream().use { input.copyTo(it) } }
            file.absolutePath
        }
    }
    private fun applyShaders() {
        val mode = budget.mode(requestedMode, number("video-params/w").toInt(), number("video-params/h").toInt(), outputWidth, outputHeight)
        if (configured && mode == effectiveMode) return
        val files = shaderPaths(mode)
        // Kazumi changes the live shader list; do not reload media or recreate the decoder.
        val args = if (files.isEmpty()) arrayOf("change-list", "glsl-shaders", "clr", "")
            else arrayOf("change-list", "glsl-shaders", "set", files.joinToString(":"))
        check(MpvNative.commandAsync(handle, args) >= 0)
        shaderFiles = files; effectiveMode = mode; configured = true
    }
    fun switchShaders(mode: Int): Boolean {
        if (renderer == "mediacodec_embed" || handle == 0L || terminalFailure) return false
        requestedMode = mode; budget.reset(requestedMode); lastBudgetAt = android.os.SystemClock.elapsedRealtime()
        if (loaded) applyShaders()
        return true
    }
    private fun updateBudget() {
        val now = android.os.SystemClock.elapsedRealtime()
        if (now - lastBudgetAt < 1000) return
        lastBudgetAt = now
        val passes = org.json.JSONObject(property("vo-passes") ?: "{}").optJSONArray("fresh")
        shaderPasses = org.json.JSONArray(); var total = 0L
        if (passes != null) for (index in 0 until passes.length()) {
            val pass = passes.getJSONObject(index)
            shaderPasses.put(pass.optString("desc")); total += pass.optLong("avg")
        }
        gpuTimeMs = total / 1_000_000.0
        if (!isPlaying || effectiveMode == 0) { budget.sample(now, number("frame-drop-count").toLong(), 0.0, 0.0, 1.0); return }
        val fps = number("container-fps").takeIf { it > 0 } ?: number("estimated-vf-fps")
        if (budget.sample(now, number("frame-drop-count").toLong(), gpuTimeMs, fps, rate.toDouble())) applyShaders()
    }
    override fun open(uri: String, descriptor: ParcelFileDescriptor?, position: Long, paused: Boolean) {
        terminalFailure = false
        networkSource = uri.startsWith("http://") || uri.startsWith("https://")
        val locator = if (descriptor != null) "fd://${descriptor.fd}" else uri
        pending = {
            check(set("pause", if (paused) "yes" else "no"))
            check(command("loadfile", locator, "replace", "-1", "start=${position / 1000.0}"))
            opened = true; firstFrameAt = android.os.SystemClock.elapsedRealtime()
        }
        if (view.holder.surface.isValid) { val load = pending; pending = null; load?.invoke() }
    }
    override fun surfaceCreated(holder: SurfaceHolder) {
        if (handle == 0L) return
        try {
            check(MpvNative.surface(handle, holder.surface) >= 0)
            outputWidth = holder.surfaceFrame.width(); outputHeight = holder.surfaceFrame.height()
            set("android-surface-size", "${outputWidth}x$outputHeight")
            check(set("vo", renderer)); set("force-window", "yes")
            attached = true
            val load = pending; pending = null; load?.invoke()
        } catch (_: Exception) { terminalFailure = true; state("playback_error", "render_failed") }
    }
    override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
        if (handle == 0L) return
        outputWidth = width; outputHeight = height
        set("android-surface-size", "${width}x$height")
        if (loaded && configured) applyShaders()
        // A paused GPU output can retain a frame rendered for the old orientation.
        // Decode the same position again after recreation; do not resume playback.
        if (frameRendered && flag("pause")) command("seek", number("time-pos").toString(), "absolute+exact")
    }
    override fun surfaceDestroyed(holder: SurfaceHolder) { attached = false; if (handle != 0L) MpvNative.surface(handle, null) }
    override fun play() { set("pause", "no") }
    override fun pause() { set("pause", "yes") }
    override fun setTime(time: Long, fast: Boolean) { check(command("seek", (time / 1000.0).toString(), "absolute+exact")); ended = false }
    override fun setAudioTrack(id: Int) = set("aid", if (id < 0) "no" else id.toString())
    override fun setSpuTrack(id: Int) = set("sid", if (id < 0) "no" else id.toString())
    override fun setSpuDelay(delay: Long) = set("sub-delay", (delay / 1_000_000.0).toString())
    override fun addSubtitle(path: String) = command("sub-add", path, "select")
    override fun onStart() { foreground = true; firstFrameAt = android.os.SystemClock.elapsedRealtime(); bufferingSince = 0 }
    override fun onStop() { foreground = false; bufferingSince = 0 }
    override fun poll() {
        if (handle == 0L || !opened || terminalFailure) return
        val events = pendingEvents or MpvNative.poll(handle)
        if (events and 1 != 0) {
            loaded = true; configured = false; budget.reset(requestedMode)
            lastBudgetAt = android.os.SystemClock.elapsedRealtime() + 2000
            applyShaders()
        }
        if (events and 4 != 0 || flag("eof-reached")) ended = true
        if (loaded && renderer == "mediacodec_embed") {
            // Direct MediaCodec output does not letterbox; size its Surface to fit.
            val parent = view.parent as? View
            val aspect = number("video-params/aspect")
            if (parent != null && aspect > 0 && parent.width > 0 && parent.height > 0) {
                val width = minOf(parent.width, (parent.height * aspect).toInt())
                val height = (width / aspect).toInt()
                if (view.layoutParams.width != width || view.layoutParams.height != height) view.layoutParams = android.widget.FrameLayout.LayoutParams(width, height, android.view.Gravity.CENTER)
            }
        }
        // Android may destroy surfaces in the background / document picker. That is
        // not an unsupported GPU and must not trigger a renderer switch.
        if (!attached || !foreground) { pendingEvents = events; return }
        pendingEvents = 0
        if (loaded && !frameRendered) frameRendered = if (renderer == "mediacodec_embed") events and 2 != 0
            else org.json.JSONObject(property("vo-passes") ?: "{}").optJSONArray("fresh")?.length()?.let { it > 0 } == true
        val waiting = flag("paused-for-cache") && !flag("pause")
        if (waiting && bufferingSince == 0L) bufferingSince = android.os.SystemClock.elapsedRealtime()
        if (!waiting) bufferingSince = 0
        updateBudget()
        val nativeProblem = MpvNative.problem(handle)
        var problem = when (nativeProblem) {
            1 -> "render_failed"; 2 -> "decode_failed"; 3 -> "source_offline"; 4 -> "credential_invalid"; 5 -> "source_missing"
            6 -> "unsupported_media"; 7 -> "audio_failed"; 8 -> "network_timeout"; 9 -> "file_unavailable"; else -> "playback_failed"
        }
        val timedOut = (!frameRendered && android.os.SystemClock.elapsedRealtime() - firstFrameAt > 30_000) ||
            (bufferingSince > 0 && android.os.SystemClock.elapsedRealtime() - bufferingSince > 45_000)
        if (timedOut && problem == "playback_failed") problem = "network_timeout"
        val truncated = events and 4 != 0 && length > 0 && time > 0 && time + 2000 < length
        if (truncated && problem == "playback_failed") problem = if (networkSource) "source_offline" else "file_unavailable"
        val next = when {
            events and 24 != 0 -> "playback_error"
            truncated -> "playback_error"
            timedOut -> "playback_error"
            ended -> "ended"
            !loaded || !frameRendered -> "opening"
            flag("paused-for-cache") -> "buffering"
            flag("pause") -> "paused"
            else -> "playing"
        }
        if (lastStatus != next) {
            lastStatus = next
            if (next == "playback_error") terminalFailure = true
            state(next, if (next == "playback_error") problem else null)
        }
    }
    override fun release() {
        view.holder.removeCallback(this)
        pending = null; opened = false; attached = false
        val old = handle; handle = 0
        if (old != 0L) MpvNative.destroy(old)
    }
}
