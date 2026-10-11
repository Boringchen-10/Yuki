package com.genzo.android

import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.ActivityInfo
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import android.view.View
import android.view.Gravity
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.FrameLayout
import android.widget.ProgressBar
import android.widget.SeekBar
import android.widget.TextView
import android.widget.Toast
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Invoke
import java.io.File
import java.security.MessageDigest
import java.lang.ref.WeakReference
import java.util.UUID

// A native validation view. OpenDesign will define the final controls and React entry flow.
class PlayerActivity : ComponentActivity() {
    companion object {
        @Volatile var snapshot = JSObject().put("status", "idle")
        var current: WeakReference<PlayerActivity>? = null
    }
    private lateinit var player: VideoEngine
    private lateinit var label: TextView
    private lateinit var seek: SeekBar
    private lateinit var viewport: FrameLayout
    private lateinit var superResolutionButton: Button
    private var superResolutionMode = 0
    private var fallbackReason: String? = null
    private var gpuError: String? = null
    private var restoringTracks: Pair<Int, Int>? = null
    private var restoreSidecar: String? = null
    private var engineGeneration = 0
    private var lastReportMs = 0L
    private lateinit var playbackSettings: PlaybackSettings
    private var rendererOverride: String? = null
    private var descriptor: ParcelFileDescriptor? = null
    private var uri = ""
    private var mediaFileId: String? = null
    private var sessionId: String? = null
    private var revision = 0L
    private var resumeMs = 0L
    private var subtitleDelayMs = 0L
    private var pendingRate: Float? = null
    private var status = "opening"
    private var ruleOperation = 0L
    private var mediaReady = false
    private var startOnResume = false
    private var loadingMessage = "正在准备视频…"
    private var loadingError: String? = null
    private lateinit var loadingPanel: LinearLayout
    private lateinit var loadingText: TextView
    private lateinit var loadingSpinner: ProgressBar
    private val mediaControls = mutableListOf<View>()
    private val subtitleFiles = mutableListOf<File>()
    private val sidecars = linkedMapOf<String, Pair<String, File>>()
    private var selectedSidecar: String? = null
    private var subtitlePicker: Invoke? = null
    private var initialSubtitle: String? = null
    private var subtitleError: String? = null
    private val handler = Handler(Looper.getMainLooper())
    private val ticker = object : Runnable {
        override fun run() {
            if (::player.isInitialized) player.poll()
            if (android.os.SystemClock.elapsedRealtime() - lastReportMs >= 1000) report()
            handler.postDelayed(this, 250)
        }
    }
    private fun identity() = MessageDigest.getInstance("SHA-256").digest(uri.toByteArray())
        .joinToString("") { "%02x".format(it) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() { finish() }
        })
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
        uri = intent.getStringExtra("uri").orEmpty()
        ruleOperation = intent.getLongExtra("ruleOperation", 0)
        if (ruleOperation > 0 && !RuleResolver.allowed(ruleOperation)) { finish(); return }
        if (uri.isEmpty() && !intent.getBooleanExtra("loading", false)) { finish(); return }
        current = WeakReference(this)
        loadingMessage = intent.getStringExtra("loadingMessage") ?: loadingMessage
        mediaFileId = intent.getStringExtra("mediaFileId")
        sessionId = intent.getStringExtra("sessionId")
        initialSubtitle = intent.getStringExtra("subtitleUri")
        resumeMs = savedInstanceState?.getLong("positionMs") ?: if (intent.getBooleanExtra("restart", false)) 0 else
            intent.getLongExtra("resumeMs", -1L).takeIf { it >= 0 } ?: getSharedPreferences("genzo-prototype-progress", 0).getLong(identity(), 0)
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(0xff101114.toInt()) }
        viewport = FrameLayout(this)
        superResolutionMode = getSharedPreferences("genzo-player", 0).getInt("anime4kMode", 0).coerceIn(0, 2)
        playbackSettings = PlaybackSettings.read(this)
        loadingPanel = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER; setPadding(24,24,24,24) }
        loadingSpinner = ProgressBar(this)
        loadingPanel.addView(loadingSpinner)
        loadingText = TextView(this).apply { setTextColor(0xffffffff.toInt()); textSize = 16f; gravity = Gravity.CENTER; setPadding(16,24,16,24) }
        loadingPanel.addView(loadingText)
        loadingPanel.addView(Button(this).apply { text = if (ruleOperation > 0) "返回选集" else "返回"; setOnClickListener { finish() } })
        viewport.addView(loadingPanel, FrameLayout.LayoutParams(-1, -2, Gravity.CENTER))
        root.addView(viewport, LinearLayout.LayoutParams(-1, 0, 1f))
        label = TextView(this).apply { setTextColor(0xffffffff.toInt()); textSize = 12f }
        root.addView(label)
        seek = SeekBar(this).apply { max = 1000 }
        root.addView(seek)
        val controls = LinearLayout(this)
        val controlHeight = (48 * resources.displayMetrics.density).toInt()
        fun button(text: String, action: () -> Unit) {
            controls.addView(Button(this).apply { this.text = text; textSize = 13f; setOnClickListener { action() } }, LinearLayout.LayoutParams(0, controlHeight, 1f))
        }
        button("暂停/播放") { if (player.isPlaying) player.pause() else player.play() }
        button("音轨") { tracks(false) }
        button("字幕") { tracks(true) }
        root.addView(controls)
        mediaControls.add(controls)
        val extra = LinearLayout(this)
        extra.addView(Button(this).apply { text = "外挂字幕"; setOnClickListener { if (subtitleSupported()) launchSubtitlePicker() } }, LinearLayout.LayoutParams(0, controlHeight, 1f))
        extra.addView(Button(this).apply { text = "字幕偏移"; setOnClickListener {
            AlertDialog.Builder(this@PlayerActivity).setItems(arrayOf("提前 500 ms", "重置", "延后 500 ms")) { _, index ->
                subtitleDelayMs = if (index == 1) 0 else subtitleDelayMs + if (index == 0) -500 else 500
                if (!player.setSpuDelay(subtitleDelayMs * 1000)) label.text = "当前字幕不支持时间偏移"
            }.show()
        } }, LinearLayout.LayoutParams(0, controlHeight, 1f))
        extra.addView(Button(this).apply { text = "横/竖屏"; setOnClickListener {
            requestedOrientation = if (resources.configuration.orientation == 2) ActivityInfo.SCREEN_ORIENTATION_PORTRAIT else ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
        } }, LinearLayout.LayoutParams(0, controlHeight, 1f))
        superResolutionButton = Button(this).apply { text = "Anime4K"; setOnClickListener {
            AlertDialog.Builder(this@PlayerActivity).setTitle("Anime4K 超分辨率")
                .setSingleChoiceItems(arrayOf("关闭", "流畅 · 适合日常观看", "画质 · 更清晰，耗电更高"), superResolutionMode) { dialog, index ->
                    dialog.dismiss(); switchSuperResolution(index)
                }.setNeutralButton("开源说明") { _, _ -> showSuperResolutionLicenses() }.setNegativeButton("取消", null).show()
        } }
        extra.addView(superResolutionButton, LinearLayout.LayoutParams(0, controlHeight, 1f))
        root.addView(extra)
        mediaControls.add(extra)
        setContentView(root)
        // A rule's loading shell must not wait for GPU/decoder initialization.
        try { createEngine(if (uri.isEmpty()) 0 else superResolutionMode, uri.isEmpty()) }
        catch (_: LinkageError) { superResolutionMode = 0; rendererOverride = "compat"; fallbackReason = "此设备无法启用GPU播放，已恢复兼容播放"; createEngine(0) }
        catch (error: Exception) { gpuError = error.message; superResolutionMode = 0; rendererOverride = "compat"; fallbackReason = "GPU初始化失败，已恢复兼容播放"; createEngine(0) }
        seek.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(bar: SeekBar?, value: Int, fromUser: Boolean) {}
            override fun onStartTrackingTouch(bar: SeekBar?) {}
            override fun onStopTrackingTouch(bar: SeekBar?) { if (player.isSeekable) player.setTime(player.length * seek.progress / 1000, false) }
        })
        if (uri.isNotEmpty()) { mediaReady = true; startMedia() }
        report()
        handler.post(ticker)
    }

    private fun createEngine(mode: Int, loadingShell: Boolean = false) {
        val generation = ++engineGeneration
        val stateChanged: (String) -> Unit = { next ->
            if (generation == engineGeneration && !isFinishing && !isDestroyed) {
                if (next == "playback_error" && player is MpvEngine) {
                    handler.post { if (generation == engineGeneration) fallbackToVlc() }
                } else {
                    status = next
                    if (next in listOf("playing", "paused") && player.length > 0) restorePlayback()
                    report()
                }
            }
        }
        val renderer = if (loadingShell) "compat" else rendererOverride ?: playbackSettings.resolve(this, mode)
        player = if (renderer != "compat") MpvEngine(this, mode, stateChanged, playbackSettings, renderer) else VlcEngine(this, stateChanged, playbackSettings.hardware)
        viewport.addView(player.view, 0, FrameLayout.LayoutParams(-1, -1))
    }

    private fun applyPlaybackSettings(settings: PlaybackSettings) {
        settings.save(this); playbackSettings = settings; rendererOverride = null
        val mode = if (settings.renderer == "mediacodec_embed") 0 else superResolutionMode
        if (settings.renderer == "mediacodec_embed") {
            selectedSidecar = null
            Toast.makeText(this, "直通模式已关闭超分与字幕", Toast.LENGTH_LONG).show()
        }
        switchSuperResolution(mode, rebuild = true)
    }

    private fun subtitleSupported(): Boolean {
        if ((player as? MpvEngine)?.renderer != "mediacodec_embed") return true
        Toast.makeText(this, "字幕需要GPU渲染，请在播放设置选择OpenGL或Vulkan", Toast.LENGTH_LONG).show()
        return false
    }

    private fun showSuperResolutionLicenses() {
        val files = listOf("THIRD_PARTY_NOTICES.md", "licenses/anime4k-MIT.txt", "licenses/mpv-android-MIT.txt", "licenses/libmpv-1.2.7/mpv-Copyright.txt", "licenses/libmpv-1.2.7/LGPL-3.0.txt")
        val text = TextView(this).apply {
            setPadding(24, 16, 24, 16); textSize = 12f; setTextIsSelectable(true)
            text = files.joinToString("\n\n") { name -> assets.open(name).bufferedReader().use { it.readText() } }
        }
        AlertDialog.Builder(this).setTitle("Anime4K 与播放组件许可")
            .setView(android.widget.ScrollView(this).apply { addView(text) }).setPositiveButton("关闭", null).show()
    }

    private fun restorePlayback() {
        if (startOnResume && lifecycle.currentState.isAtLeast(androidx.lifecycle.Lifecycle.State.RESUMED)) { startOnResume = false; player.play() }
        if (player is MpvEngine || player.isPlaying) pendingRate?.let { pendingRate = null; player.rate = it }
        if (resumeMs > 0) {
            val position = resumeMs; resumeMs = 0
            // mpv already received start=position. A second initial seek can interrupt
            // its first hardware-decoded frame; LibVLC still needs this restoration.
            if (player !is MpvEngine) player.setTime(position, false)
        }
        restoringTracks?.let { (audio, subtitle) ->
            restoringTracks = null
            player.audioTracks.getOrNull(audio)?.let { player.setAudioTrack(it.id) }
            if ((player as? MpvEngine)?.renderer == "mediacodec_embed") player.setSpuTrack(-1)
            else if (restoreSidecar == null) player.spuTracks.getOrNull(subtitle)?.let { player.setSpuTrack(it.id) }
        }
        restoreSidecar?.let { id ->
            restoreSidecar = null
            if ((player as? MpvEngine)?.renderer != "mediacodec_embed") sidecars[id]?.let { if (player.addSubtitle(it.second.absolutePath)) selectedSidecar = id else subtitleError = "外挂字幕恢复失败，请重新选择" }
        }
        if (subtitleDelayMs != 0L) player.setSpuDelay(subtitleDelayMs * 1000)
        val initialFile = intent.getStringExtra("subtitleFile")
        if (initialSubtitle != null || initialFile != null) {
            val selected = initialSubtitle
            initialSubtitle = null
            intent.removeExtra("subtitleFile")
            try {
                val file = initialFile?.let { path -> File(path).also {
                    require(it.canonicalPath.startsWith(File(applicationInfo.dataDir, "player-subtitles").canonicalPath + "/"))
                    require(it.length() <= 16 * 1024 * 1024)
                    subtitleFiles.add(it)
                } }
                if ((player as? MpvEngine)?.renderer != "mediacodec_embed") {
                    if (file != null) selectSidecar(file, intent.getStringExtra("subtitleLabel"), intent.getStringExtra("subtitleId"))
                    else loadSubtitle(Uri.parse(requireNotNull(selected)), intent.getStringExtra("subtitleId"))
                }
            } catch (_: Exception) { subtitleError = "外挂字幕无法加载，请手动选择" }
        }
    }

    private fun switchSuperResolution(mode: Int, fallback: Boolean = false, rebuild: Boolean = false) {
        require(mode in 0..2)
        if (!mediaReady) return
        if (!fallback) {
            rendererOverride = null
            if (mode > 0 && playbackSettings.renderer == "mediacodec_embed") { playbackSettings = playbackSettings.copy(renderer = "gpu"); playbackSettings.save(this) }
            fallbackReason = null
            gpuError = null
            getSharedPreferences("genzo-player", 0).edit().putInt("anime4kMode", mode).apply()
        }
        if (!fallback && !rebuild && mode == superResolutionMode && (mode == 0 || player is MpvEngine)) { report(); return }
        val paused = (!player.isPlaying && status !in listOf("opening", "buffering")) || startOnResume
        resumeMs = player.time.takeIf { it > 0 } ?: resumeMs
        pendingRate = pendingRate ?: player.rate
        restoringTracks = Pair(player.audioTracks.indexOfFirst { it.id == player.audioTrack }, player.spuTracks.indexOfFirst { it.id == player.spuTrack })
        restoreSidecar = selectedSidecar
        engineGeneration++
        player.release(); viewport.removeView(player.view); descriptor?.close(); descriptor = null
        superResolutionMode = mode
        status = "opening"; loadingMessage = "正在切换画面处理…"
        try { createEngine(mode) }
        catch (_: LinkageError) { superResolutionMode = 0; rendererOverride = "compat"; fallbackReason = "此设备无法启用GPU播放，已恢复兼容播放"; createEngine(0) }
        catch (error: Exception) { gpuError = error.message; superResolutionMode = 0; rendererOverride = "compat"; fallbackReason = "GPU初始化失败，已恢复兼容播放"; createEngine(0) }
        startMedia(paused); report()
    }

    private fun fallbackToVlc() {
        if (isFinishing || isDestroyed || player !is MpvEngine) return
        val openGl = (player as MpvEngine).renderer == "gpu-next"
        rendererOverride = if (openGl) "gpu" else "compat"
        fallbackReason = if (openGl) "Vulkan播放不可用，已切换OpenGL" else "此视频或设备无法使用GPU播放，已恢复兼容播放"
        Toast.makeText(this, fallbackReason, Toast.LENGTH_LONG).show()
        switchSuperResolution(if (openGl) superResolutionMode else 0, true, true)
    }

    private fun startMedia(paused: Boolean = false) {
        try {
            val locator = Uri.parse(uri)
            if (locator.scheme == "content") descriptor = contentResolver.openFileDescriptor(locator, "r") ?: throw IllegalStateException("Unreadable document")
            val background = ruleOperation > 0 && !lifecycle.currentState.isAtLeast(androidx.lifecycle.Lifecycle.State.RESUMED)
            startOnResume = background && !paused
            player.open(uri, descriptor, resumeMs, paused || background)
        } catch (_: SecurityException) { status = "permission_denied" }
        catch (_: Exception) {
            if (player is MpvEngine) { val generation = engineGeneration; handler.post { if (generation == engineGeneration) fallbackToVlc() } }
            else status = "playback_error"
        }
    }

    private fun requireRuleSession(args: PlayerArgs) {
        require(!isFinishing && !isDestroyed && args.sessionId == sessionId && args.ruleOperation == ruleOperation && RuleResolver.allowed(ruleOperation))
    }

    fun updateRuleLoading(args: PlayerArgs) {
        requireRuleSession(args)
        require(!mediaReady)
        loadingMessage = args.loadingMessage
        if (args.loadingError) { loadingError = args.loadingMessage; status = "playback_error" }
        report()
    }

    fun acceptRuleMedia(args: PlayerArgs) {
        requireRuleSession(args)
        require(!mediaReady && Uri.parse(args.uri).scheme in listOf("http", "https"))
        uri = args.uri; mediaFileId = args.mediaFileId; resumeMs = args.resumeMs ?: 0
        initialSubtitle = args.subtitleUri
        intent.putExtra("subtitleFile", args.subtitleFile).putExtra("subtitleLabel", args.subtitleLabel).putExtra("subtitleId", args.subtitleId)
        mediaReady = true; loadingError = null; loadingMessage = "正在连接视频…"; status = "opening"
        if (playbackSettings.resolve(this, superResolutionMode) != "compat" && player is VlcEngine && fallbackReason == null) switchSuperResolution(superResolutionMode, rebuild = true)
        else startMedia()
        report()
    }

    fun cancelRuleLoading(cancelledThrough: Long) {
        if (ruleOperation > 0 && ruleOperation <= cancelledThrough && !mediaReady) { status = "closed"; report(); finish() }
    }

    private fun tracks(subtitle: Boolean) {
        if (subtitle && !subtitleSupported()) return
        val items = (if (subtitle) player.spuTracks else player.audioTracks)
        AlertDialog.Builder(this).setItems(items.map { "${it.id}: ${it.name}" }.toTypedArray()) { _, index ->
            val changed = if (subtitle) player.setSpuTrack(items[index].id) else player.setAudioTrack(items[index].id)
            if (changed && subtitle) selectedSidecar = null
        }.show()
    }

    @Deprecated("Prototype uses the platform result API")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != 20) return
        val pending = subtitlePicker
        subtitlePicker = null
        val selected = data?.data
        if (resultCode != RESULT_OK || selected == null) { pending?.resolve(JSObject().put("status", "cancelled")); return }
        try {
            if (((data?.flags ?: 0) and Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION) != 0) {
                contentResolver.takePersistableUriPermission(selected, Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            val track = loadSubtitle(selected)
            report()
            pending?.resolve(JSObject().put("status", "selected").put("track", track))
        } catch (_: SecurityException) { pending?.resolve(JSObject().put("status", "permission_denied")); Toast.makeText(this, "无法读取所选字幕，请重新授权", Toast.LENGTH_LONG).show() }
        catch (_: Exception) { pending?.resolve(JSObject().put("status", "subtitle_error")); Toast.makeText(this, "请选择不超过 16 MiB 的 SRT、ASS 或 SSA 字幕", Toast.LENGTH_LONG).show() }
    }

    private fun launchSubtitlePicker() {
        startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).setType("*/*").addCategory(Intent.CATEGORY_OPENABLE)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION), 20)
    }

    fun pickSubtitle(invoke: Invoke, expectedSession: String) {
        if (sessionId != expectedSession || isFinishing || isDestroyed) { invoke.reject("expired_player_session"); return }
        if (subtitlePicker != null) { invoke.reject("subtitle_picker_busy"); return }
        if (!subtitleSupported()) { invoke.reject("字幕需要GPU渲染"); return }
        subtitlePicker = invoke
        try { launchSubtitlePicker() } catch (_: Exception) { subtitlePicker = null; invoke.resolve(JSObject().put("status", "subtitle_error")) }
    }

    private fun loadSubtitle(selected: Uri, trackId: String? = null): JSObject {
        require(selected.scheme == "content")
        val name = contentResolver.query(selected, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
            if (it.moveToFirst()) it.getString(0) else null
        }
        val extension = name?.substringAfterLast('.')?.lowercase()
        require(extension in listOf("srt", "ass", "ssa"))
        // Copy only the chosen small sidecar, never the video. Files are deleted with this player instance.
        val file = File(cacheDir, "prototype-subtitle-${System.nanoTime()}.$extension")
        subtitleFiles.add(file)
        contentResolver.openInputStream(selected)?.use { input -> file.outputStream().use { output ->
            val bytes = ByteArray(8192); var total = 0L
            while (true) { val count = input.read(bytes); if (count < 0) break
                total += count; require(total <= 16 * 1024 * 1024); output.write(bytes, 0, count) }
        } } ?: throw IllegalStateException("Unreadable subtitle")
        return selectSidecar(file, name, trackId)
    }

    private fun selectSidecar(file: File, name: String?, trackId: String?): JSObject {
        require(file.extension.lowercase() in listOf("srt", "ass", "ssa"))
        check(player.addSubtitle(file.absolutePath))
        val id = trackId ?: "sidecar:${UUID.randomUUID()}"
        sidecars[id] = Pair(name ?: "外挂字幕", file)
        selectedSidecar = id
        subtitleError = null
        return JSObject().put("id", id).put("label", name ?: "外挂字幕").put("kind", "sidecar").put("available", true)
    }

    private fun setPlaybackRate(rate: Float) {
        // Changing rate while paused can discard the active subtitle cue in LibVLC 3.7.7.
        // Retain the chosen speed and apply it when playback resumes.
        if (status == "paused" || !player.isPlaying) pendingRate = rate else player.rate = rate
    }

    fun control(args: ControlArgs): JSObject {
        require(args.sessionId == null || (args.sessionId == sessionId && !isFinishing && !isDestroyed))
        when (args.action) {
            "play" -> player.play()
            "pause" -> player.pause()
            "seek" -> { require(player.isSeekable && args.value >= 0 && args.value <= player.length); player.setTime(args.value.toLong(), false) }
            "rate" -> { require(args.value in .5..2.0); setPlaybackRate(args.value.toFloat()) }
            "audio" -> {
                val id = args.trackId?.toInt() ?: args.value.toInt()
                require(player.audioTracks.any { it.id == id } == true)
                check(player.setAudioTrack(id))
            }
            "subtitle" -> {
                require(subtitleSupported())
                val sidecar = args.trackId?.let { sidecars[it] }
                if (sidecar != null) { check(player.addSubtitle(sidecar.second.absolutePath)); selectedSidecar = args.trackId }
                else {
                    val id = args.trackId?.toInt() ?: args.value.toInt()
                    require(player.spuTracks.any { it.id == id } == true)
                    check(player.setSpuTrack(id)); selectedSidecar = null
                }
            }
            "subtitleOffset" -> { require(args.value in -60000.0..60000.0); subtitleDelayMs = args.value.toLong(); check(player.setSpuDelay(subtitleDelayMs * 1000)) }
            "externalSubtitle" -> { require(subtitleSupported()); loadSubtitle(Uri.parse(requireNotNull(args.uri))) }
            "playbackSettings" -> applyPlaybackSettings(PlaybackSettings(args.hardwareDecoding, args.hardwareDecoder, args.videoRenderer))
            "landscape" -> requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
            "portrait" -> requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
            "system" -> requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
            "superResolution" -> { require(args.value in 0.0..2.0 && args.value % 1.0 == 0.0); switchSuperResolution(args.value.toInt()) }
            "close" -> { player.pause(); status = "closed"; finish() }
            else -> throw IllegalArgumentException("Unknown action")
        }
        report()
        return snapshot
    }

    private fun report() {
        if (!::player.isInitialized) return
        lastReportMs = android.os.SystemClock.elapsedRealtime()
        fun trackList(items: Array<VideoTrack>?) = JSArray().apply {
            items?.forEach { put(JSObject().put("id", it.id).put("name", it.name)) }
        }
        val subtitleTracks = trackList(player.spuTracks)
        sidecars.forEach { (id, entry) -> subtitleTracks.put(JSObject().put("id", id).put("name", entry.first).put("kind", "sidecar")) }
        snapshot = JSObject().put("status", status).put("engine", player.name).put("positionMs", player.time)
            .put("loadingMessage", loadingMessage).put("ruleOperation", ruleOperation)
            .put("mediaFileId", mediaFileId).put("sessionId", sessionId).put("revision", ++revision)
            .put("updatedAtMs", System.currentTimeMillis())
            .put("durationMs", player.length).put("seekable", player.isSeekable).put("rate", pendingRate ?: player.rate)
            .put("audioTracks", trackList(player.audioTracks)).put("subtitleTracks", subtitleTracks).put("selectedSidecar", selectedSidecar)
            .put("audioTrack", player.audioTrack).put("subtitleTrack", player.spuTrack).put("subtitleDelayUs", player.spuDelay)
            .put("subtitleOffsetMs", player.spuDelay / 1000)
        snapshot.put("superResolution", superResolutionMode).put("superResolutionFallback", fallbackReason).put("gpuError", gpuError)
            .put("playbackSettings", JSObject().put("hardwareDecoding", playbackSettings.hardware).put("hardwareDecoder", playbackSettings.decoder).put("videoRenderer", playbackSettings.renderer))
        (player as? MpvEngine)?.let { mpv ->
            snapshot.put("shaderCount", mpv.shaderFiles.size).put("gpuRenderer", mpv.property("current-vo"))
                .put("decoder", mpv.property("hwdec-current")).put("droppedFrames", mpv.property("frame-drop-count"))
                .put("videoWidth", mpv.property("video-params/w")).put("videoHeight", mpv.property("video-params/h"))
            val passes = org.json.JSONObject(mpv.property("vo-passes") ?: "{}").optJSONArray("fresh")
            val descriptions = JSArray()
            var gpuTimeNs = 0L
            if (passes != null) for (index in 0 until passes.length()) {
                val pass = passes.getJSONObject(index)
                descriptions.put(pass.optString("desc")); gpuTimeNs += pass.optLong("avg")
            }
            snapshot.put("shaderPasses", descriptions).put("gpuTimeMs", gpuTimeNs / 1_000_000.0)
        }
        val superResolutionLabel = when (superResolutionMode) { 1 -> "超分·流畅"; 2 -> "超分·画质"; else -> "超分·关" }
        if (superResolutionButton.text.toString() != superResolutionLabel) superResolutionButton.text = superResolutionLabel
        if (loadingError != null && status != "closed") snapshot.put("error", JSObject().put("code", "unknown").put("message", loadingError).put("retryable", true))
        val loading = status in listOf("opening", "buffering", "playback_error")
        loadingPanel.visibility = if (loading) View.VISIBLE else View.GONE
        loadingSpinner.visibility = if (loadingError != null || status == "playback_error") View.GONE else View.VISIBLE
        loadingText.text = loadingError ?: if (status == "playback_error") "视频播放失败，请返回选集重试或切换线路。" else if (status == "buffering") "正在缓冲视频…" else loadingMessage
        mediaControls.forEach { it.visibility = if (mediaReady && loadingError == null) View.VISIBLE else View.GONE }
        seek.visibility = if (mediaReady && loadingError == null) View.VISIBLE else View.GONE
        label.visibility = if (mediaReady && status != "playback_error") View.VISIBLE else View.GONE
        val playbackLabel = fallbackReason ?: subtitleError ?: "${status} · ${player.time / 1000}/${player.length / 1000}s · ${player.rate}× · ${subtitleDelayMs}ms"
        if (label.text.toString() != playbackLabel) label.text = playbackLabel
        if (player.length > 0 && !seek.isPressed) seek.progress = (player.time * 1000 / player.length).toInt().coerceIn(0, 1000)
        if (player.time >= 0 && player.length > 0) getSharedPreferences("genzo-prototype-progress", 0).edit().putLong(identity(), player.time).apply()
        if (mediaFileId != null && player.time >= 0 && player.length > 0) {
            getSharedPreferences("genzo-player", 0).edit().putString("lastProgress", snapshot.toString()).apply()
        }
    }

    override fun onStart() { super.onStart(); if (::player.isInitialized) player.onStart() }
    override fun onResume() { super.onResume(); if (startOnResume && mediaReady && player.length > 0) { startOnResume = false; player.play() } }
    override fun onPause() { if (::player.isInitialized) { if (mediaReady) player.pause(); status = if (isFinishing) "closed" else if (mediaReady) "paused" else status; if (isFinishing && ruleOperation > 0) RuleResolver.cancel(ruleOperation); report() }; super.onPause() }
    override fun onStop() { if (::player.isInitialized) player.onStop(); super.onStop() }
    override fun onSaveInstanceState(outState: Bundle) { if (::player.isInitialized) outState.putLong("positionMs", player.time); super.onSaveInstanceState(outState) }
    override fun onDestroy() {
        if (ruleOperation > 0) RuleResolver.cancel(ruleOperation)
        subtitlePicker?.resolve(JSObject().put("status", "cancelled")); subtitlePicker = null
        handler.removeCallbacks(ticker)
        if (::player.isInitialized) { status = "closed"; report(); engineGeneration++; player.release() }
        descriptor?.close()
        subtitleFiles.forEach { it.delete() }
        if (current?.get() === this) current = null
        super.onDestroy()
    }
}
