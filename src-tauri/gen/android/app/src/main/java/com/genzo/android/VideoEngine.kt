package com.genzo.android

import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.ParcelFileDescriptor
import android.view.Surface
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.View
import org.videolan.libvlc.LibVLC
import org.videolan.libvlc.Media
import org.videolan.libvlc.MediaPlayer
import org.videolan.libvlc.interfaces.IMedia
import org.videolan.libvlc.util.VLCVideoLayout
import java.io.File

data class VideoTrack(val id: Int, val name: String)

// Both source resolution and Activity/session ownership remain shared by both renderers.
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

class VlcEngine(context: Context, private val state: (String) -> Unit, private val hardware: Boolean = true) : VideoEngine {
    private val vlc = LibVLC(context, arrayListOf("--no-video-title-show", "--network-caching=1500"))
    private val player = MediaPlayer(vlc)
    override val view = VLCVideoLayout(context)
    override val name = "LibVLC 3.7.7"
    override val isPlaying get() = player.isPlaying
    override val time get() = player.time
    override val length get() = player.length
    override val isSeekable get() = player.isSeekable
    override var rate: Float
        get() = player.rate
        set(value) { player.rate = value }
    private fun tracks(items: Array<MediaPlayer.TrackDescription>?) = items?.map { VideoTrack(it.id, it.name) }?.toTypedArray() ?: emptyArray()
    override val audioTracks get() = tracks(player.audioTracks)
    override val spuTracks get() = tracks(player.spuTracks)
    override val audioTrack get() = player.audioTrack
    override val spuTrack get() = player.spuTrack
    override val spuDelay get() = player.spuDelay
    init {
        player.attachViews(view, null, true, false)
        player.setEventListener { event ->
            when (event.type) {
                MediaPlayer.Event.Playing -> state("playing")
                MediaPlayer.Event.Paused -> state("paused")
                MediaPlayer.Event.Buffering -> state(if (event.buffering < 100) "buffering" else if (player.isPlaying) "playing" else "paused")
                MediaPlayer.Event.EndReached -> state(if (player.length > 0) "ended" else "playback_error")
                MediaPlayer.Event.EncounteredError -> state("playback_error")
            }
        }
    }
    override fun open(uri: String, descriptor: ParcelFileDescriptor?, position: Long, paused: Boolean) {
        val media = if (descriptor != null) Media(vlc, descriptor.fileDescriptor) else Media(vlc, Uri.parse(uri))
        val emulator = BuildConfig.DEBUG && Build.HARDWARE in listOf("ranchu", "goldfish")
        media.setHWDecoderEnabled(hardware && !emulator, false)
        if (paused) media.addOption(":start-paused")
        player.media = media; media.release()
        // Activity restores the LibVLC position on Playing, as before.
        player.play()
    }
    override fun play() { player.play() }
    override fun pause() { player.pause() }
    override fun setTime(time: Long, fast: Boolean) { player.setTime(time, fast) }
    override fun setAudioTrack(id: Int) = player.setAudioTrack(id)
    override fun setSpuTrack(id: Int) = player.setSpuTrack(id)
    override fun setSpuDelay(delay: Long) = player.setSpuDelay(delay)
    override fun addSubtitle(path: String) = player.addSlave(IMedia.Slave.Type.Subtitle, path, true)
    override fun onStart() { if (!player.vlcVout.areViewsAttached()) { player.detachViews(); player.attachViews(view, null, true, false) } }
    override fun onStop() { player.detachViews() }
    override fun release() { player.setEventListener(null); player.stop(); player.detachViews(); player.release(); vlc.release() }
}

// Small handle-based JNI facade. libmpv is loaded only when Anime4K is selected.
object MpvNative {
    init { System.loadLibrary("mpv"); System.loadLibrary("genzompv") }
    external fun create(): Long
    external fun option(handle: Long, key: String, value: String): Int
    external fun init(handle: Long): Int
    external fun command(handle: Long, args: Array<String>): Int
    external fun get(handle: Long, key: String): String?
    external fun set(handle: Long, key: String, value: String): Int
    external fun surface(handle: Long, surface: Surface?): Int
    external fun poll(handle: Long): Int
    external fun destroy(handle: Long)
}

class MpvEngine(context: Context, mode: Int, private val state: (String) -> Unit, settings: PlaybackSettings, val renderer: String) : VideoEngine, SurfaceHolder.Callback {
    override val view = SurfaceView(context)
    override val name = if (mode > 0) "libmpv · Anime4K" else "libmpv"
    private var handle = MpvNative.create().also { check(it != 0L) }
    private var opened = false
    private var loaded = false
    private var frameRendered = false
    private var ended = false
    private var pending: (() -> Unit)? = null
    private var lastStatus = "opening"
    private var firstFrameAt = 0L
    private var attached = false
    val shaderFiles: List<String>
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
        val names = if (mode == 2) listOf("Clamp_Highlights", "Restore_CNN_VL", "Upscale_CNN_x2_VL", "AutoDownscalePre_x2", "AutoDownscalePre_x4", "Upscale_CNN_x2_M")
            else listOf("Clamp_Highlights", "Restore_CNN_M", "Upscale_CNN_x2_M", "AutoDownscalePre_x2", "AutoDownscalePre_x4", "Upscale_CNN_x2_S")
        try {
            // Versioned app-private copies; assets are byte-for-byte upstream MIT shaders.
            val shaders = File(context.filesDir, "anime4k/7684e958").apply { mkdirs() }
            shaderFiles = (if (mode > 0) names else emptyList()).map { "Anime4K_$it.glsl" }.map { name ->
                val file = File(shaders, name)
                context.assets.open("anime4k/$name").use { input -> file.outputStream().use { input.copyTo(it) } }
                file.absolutePath
            }
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
                "demuxer-max-bytes" to "67108864",
                "demuxer-max-back-bytes" to "16777216",
                "glsl-shaders" to shaderFiles.joinToString(":"),
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
    override fun open(uri: String, descriptor: ParcelFileDescriptor?, position: Long, paused: Boolean) {
        val locator = if (descriptor != null) "fd://${descriptor.fd}" else uri
        pending = {
            check(set("pause", if (paused) "yes" else "no"))
            check(command("loadfile", locator, "replace", "-1", "start=${position / 1000.0}"))
            opened = true; firstFrameAt = System.currentTimeMillis()
        }
        if (view.holder.surface.isValid) { val load = pending; pending = null; load?.invoke() }
    }
    override fun surfaceCreated(holder: SurfaceHolder) {
        if (handle == 0L) return
        try {
            check(MpvNative.surface(handle, holder.surface) >= 0)
            set("android-surface-size", "${holder.surfaceFrame.width()}x${holder.surfaceFrame.height()}")
            check(set("vo", renderer)); set("force-window", "yes")
            attached = true
            val load = pending; pending = null; load?.invoke()
        } catch (_: Exception) { state("playback_error") }
    }
    override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
        if (handle == 0L) return
        set("android-surface-size", "${width}x$height")
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
    override fun poll() {
        if (handle == 0L || !opened) return
        val events = MpvNative.poll(handle)
        if (events and 1 != 0) loaded = true
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
        if (!attached) return
        if (loaded && !frameRendered) frameRendered = if (renderer == "mediacodec_embed") events and 2 != 0
            else org.json.JSONObject(property("vo-passes") ?: "{}").optJSONArray("fresh")?.length()?.let { it > 0 } == true
        val next = when {
            events and 24 != 0 -> "playback_error"
            !frameRendered && System.currentTimeMillis() - firstFrameAt > 30_000 -> "playback_error"
            ended -> "ended"
            !loaded || !frameRendered -> "opening"
            flag("paused-for-cache") -> "buffering"
            flag("pause") -> "paused"
            else -> "playing"
        }
        if (lastStatus != next) { lastStatus = next; state(next) }
    }
    override fun release() {
        view.holder.removeCallback(this)
        if (handle != 0L) { MpvNative.destroy(handle); handle = 0 }
    }
}
