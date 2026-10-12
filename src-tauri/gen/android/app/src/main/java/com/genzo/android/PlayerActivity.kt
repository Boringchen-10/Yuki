package com.genzo.android

import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
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
import android.widget.PopupWindow
import com.google.android.material.bottomsheet.BottomSheetDialog
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Invoke
import java.io.File
import java.security.MessageDigest
import java.lang.ref.WeakReference
import java.util.UUID

// Native video surface with the portrait library / Bangumi panel beneath it.
class PlayerActivity : ComponentActivity() {
    companion object {
        @Volatile var snapshot = JSObject().put("status", "idle")
        var current: WeakReference<PlayerActivity>? = null
    }
    private lateinit var player: MpvEngine
    private var engineActive = false
    private var problem: PlaybackFailure? = null
    private var playbackFailed = false
    private var lastPosition = 0L
    private var lastDuration = 0L
    private var desiredPaused = false
    private var softwareOverride = false
    private var attemptRenderer = "gpu"
    private var attemptHardware = true
    private val recoveryAttempts = mutableSetOf<String>()
    private lateinit var label: TextView
    private lateinit var seek: SeekBar
    private lateinit var viewport: FrameLayout
    private lateinit var root: LinearLayout
    private lateinit var page: PlayerPage
    private lateinit var chrome: FrameLayout
    private lateinit var playButton: TextView
    private lateinit var titleView: TextView
    private lateinit var moreButton: TextView
    private lateinit var transport: LinearLayout
    private var transportShown = true
    private var controlsVisible = true
    private var settingsMenu: PopupWindow? = null
    private val hideControls = Runnable { if (status == "playing" && !seek.isPressed && settingsMenu?.isShowing != true) showControls(false) }
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
    private var sourceKind = "rule"
    private val ruleMedia get() = ruleOperation > 0 && sourceKind == "rule"
    private var mediaReady = false
    private var startOnResume = false
    private var loadingMessage = "正在准备视频…"
    private var loadingError: String? = null
    private lateinit var loadingPanel: LinearLayout
    private lateinit var loadingText: TextView
    private lateinit var loadingSpinner: ProgressBar
    private lateinit var retryButton: Button
    private lateinit var detailsButton: Button
    private val subtitleFiles = mutableListOf<File>()
    private val sidecars = linkedMapOf<String, Pair<String, File>>()
    private var selectedSidecar: String? = null
    private var subtitlePicker: Invoke? = null
    private var initialSubtitle: String? = null
    private var subtitleError: String? = null
    private val handler = Handler(Looper.getMainLooper())
    private val ticker = object : Runnable {
        override fun run() {
            if (isFinishing || isDestroyed || current?.get() !== this@PlayerActivity) return
            if (engineActive) player.poll()
            if (android.os.SystemClock.elapsedRealtime() - lastReportMs >= 1000) report()
            handler.postDelayed(this, 250)
        }
    }
    private fun identity() = MessageDigest.getInstance("SHA-256").digest(uri.toByteArray())
        .joinToString("") { "%02x".format(it) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE) requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
                else finish()
            }
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
        root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(0xff0d1612.toInt()) }
        viewport = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        superResolutionMode = getSharedPreferences("genzo-player", 0).getInt("anime4kMode", 0).coerceIn(0, 2)
        playbackSettings = PlaybackSettings.read(this)
        loadingPanel = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER; setPadding(dp(16),dp(4),dp(16),dp(4)) }
        loadingSpinner = ProgressBar(this)
        loadingPanel.addView(loadingSpinner, LinearLayout.LayoutParams(dp(26), dp(26)).apply { gravity = Gravity.CENTER_HORIZONTAL })
        loadingText = TextView(this).apply { setTextColor(0xffffffff.toInt()); textSize = 13f; gravity = Gravity.CENTER; setPadding(dp(8),dp(2),dp(8),dp(2)) }
        loadingPanel.addView(loadingText)
        val failureActions = LinearLayout(this).apply { gravity = Gravity.CENTER }
        retryButton = Button(this).apply { text = "重试播放"; setOnClickListener { if (ruleMedia || !mediaReady) finish() else retryPlayback() } }
        failureActions.addView(retryButton, LinearLayout.LayoutParams(0, dp(44), 1f))
        detailsButton = Button(this).apply { text = "错误详情"; setOnClickListener { showFailureDetails() } }
        failureActions.addView(detailsButton, LinearLayout.LayoutParams(0, dp(44), 1f))
        loadingPanel.addView(failureActions)
        viewport.addView(loadingPanel, FrameLayout.LayoutParams(-1, -1, Gravity.TOP))
        root.addView(viewport, LinearLayout.LayoutParams(-1, dp(220)))
        chrome = FrameLayout(this)
        val top = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL; setBackgroundColor(0x55000000); setPadding(dp(4), 0, dp(4), 0) }
        top.addView(icon("‹", "返回") { onBackPressedDispatcher.onBackPressed() }, LinearLayout.LayoutParams(dp(48), dp(48)))
        titleView = TextView(this).apply { text = "视频播放"; textSize = 14f; setTextColor(Color.WHITE); maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END }
        top.addView(titleView, LinearLayout.LayoutParams(0, -2, 1f))
        moreButton = icon("⋮", "更多播放设置") { showSettingsMenu() }
        top.addView(moreButton, LinearLayout.LayoutParams(dp(48), dp(48)))
        chrome.addView(top, FrameLayout.LayoutParams(-1, dp(48), Gravity.TOP))
        val bottom = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL; setBackgroundColor(0x77000000); setPadding(dp(2), 0, dp(2), 0) }
        transport = bottom
        playButton = icon("▶", "暂停/播放") { if (engineActive && problem == null) { if (player.isPlaying) player.pause() else player.play(); showControls(true) } }
        bottom.addView(playButton, LinearLayout.LayoutParams(dp(44), dp(48)))
        seek = SeekBar(this).apply { max = 1000; progressTintList = ColorStateList.valueOf(0xff4cc197.toInt()); thumbTintList = progressTintList }
        bottom.addView(seek, LinearLayout.LayoutParams(0, dp(48), 1f))
        label = TextView(this).apply { setTextColor(Color.WHITE); textSize = 11f; gravity = Gravity.CENTER; minWidth = dp(82) }
        bottom.addView(label, LinearLayout.LayoutParams(-2, dp(48)))
        bottom.addView(icon("⛶", "横/竖屏") { requestedOrientation = if (resources.configuration.orientation == 2) ActivityInfo.SCREEN_ORIENTATION_PORTRAIT else ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE }, LinearLayout.LayoutParams(dp(44), dp(48)))
        chrome.addView(bottom, FrameLayout.LayoutParams(-1, dp(48), Gravity.BOTTOM))
        viewport.addView(chrome, FrameLayout.LayoutParams(-1, -1))
        viewport.setOnClickListener { showControls(!controlsVisible) }
        page = PlayerPage(this, sessionId) { mediaFileId }
        root.addView(page, LinearLayout.LayoutParams(-1, 0, 1f))
        setContentView(root)
        ViewCompat.setOnApplyWindowInsetsListener(root) { _, insets ->
            val cutout = insets.getInsets(WindowInsetsCompat.Type.displayCutout())
            val navigation = insets.getInsetsIgnoringVisibility(WindowInsetsCompat.Type.navigationBars())
            chrome.setPadding(cutout.left, cutout.top, cutout.right, 0)
            layoutLoading()
            page.setPadding(dp(16), 0, dp(16), navigation.bottom)
            insets
        }
        ViewCompat.requestApplyInsets(root)
        root.addOnLayoutChangeListener { _, left, _, right, _, oldLeft, _, oldRight, _ -> if (right-left != oldRight-oldLeft) layoutPlayer() }
        layoutPlayer()
        // A rule's loading shell must not wait for GPU/decoder initialization.
        seek.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(bar: SeekBar?, value: Int, fromUser: Boolean) {}
            override fun onStartTrackingTouch(bar: SeekBar?) { handler.removeCallbacks(hideControls) }
            override fun onStopTrackingTouch(bar: SeekBar?) { if (engineActive && player.isSeekable) runCatching { player.setTime(player.length * seek.progress / 1000, false) }.onFailure { fail("playback_failed") }; showControls(true) }
        })
        if (uri.isNotEmpty()) { mediaReady = true; createEngine(superResolutionMode) }
        report()
        handler.post(ticker)
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
    private fun icon(symbol: String, description: String, action: () -> Unit) = TextView(this).apply {
        text = symbol; textSize = 24f; gravity = Gravity.CENTER; setTextColor(Color.WHITE); contentDescription = description
        isFocusable = true; setOnClickListener { action() }
        background = android.graphics.drawable.RippleDrawable(ColorStateList.valueOf(0x44ffffff), null, GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(Color.WHITE) })
    }
    private fun showControls(visible: Boolean) {
        if (controlsVisible != visible) PlayerMotion.visibility(chrome, visible)
        controlsVisible = visible
        handler.removeCallbacks(hideControls)
        if (visible && status == "playing") handler.postDelayed(hideControls, 3500)
    }
    private fun layoutPlayer() {
        val landscape = resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE
        val returning = !landscape && page.visibility != View.VISIBLE
        page.visibility = if (landscape) View.GONE else View.VISIBLE
        if (returning) PlayerMotion.enter(page)
        viewport.layoutParams = LinearLayout.LayoutParams(-1, if (landscape) 0 else ((root.width.takeIf { it > 0 } ?: resources.displayMetrics.widthPixels) * 9 / 16), if (landscape) 1f else 0f)
        showControls(true)
    }
    private fun layoutLoading() {
        val params = loadingPanel.layoutParams as FrameLayout.LayoutParams
        val top = chrome.paddingTop + dp(48)
        val bottom = if (transportShown) dp(48) else 0
        if (params.topMargin != top || params.bottomMargin != bottom) {
            params.topMargin = top; params.bottomMargin = bottom; loadingPanel.layoutParams = params
        }
    }
    override fun onConfigurationChanged(config: Configuration) {
        super.onConfigurationChanged(config); settingsMenu?.dismiss(); layoutPlayer()
    }
    fun takePageRequest(expected: String): JSObject {
        if (expected != sessionId) return JSObject()
        if (isFinishing || isDestroyed) return JSObject().put("closed", true)
        return page.takeRequest()?.let { JSObject(it.toString()) } ?: JSObject()
    }
    fun updatePage(args: PlayerPageArgs) {
        if (args.sessionId != sessionId || isFinishing || isDestroyed || current?.get() !== this) return
        val data = org.json.JSONObject(args.data)
        page.accept(args.channel, data, args.requestId)
        if (args.channel == "context" && !data.has("error")) titleView.text = data.optString("title", "视频播放")
    }
    private fun showChoice(title: String, items: List<String>, selected: Int = -1, action: (Int) -> Unit) {
        handler.removeCallbacks(hideControls)
        val dialog = BottomSheetDialog(this)
        dialog.setDismissWithAnimation(PlayerMotion.enabled)
        val column = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(16), dp(12), dp(16), dp(24)); setBackgroundColor(0xff18231e.toInt()) }
        column.addView(TextView(this).apply { text = title; textSize = 17f; setTextColor(Color.WHITE); setPadding(0, dp(8), 0, dp(16)) })
        items.forEachIndexed { index, item -> column.addView(TextView(this).apply {
            text = (if (index == selected) "✓  " else "") + item; textSize = 15f; gravity = Gravity.CENTER_VERTICAL; minimumHeight = dp(48)
            setTextColor(if (index == selected) 0xff4cc197.toInt() else 0xffe6ebe7.toInt())
            setOnClickListener { dialog.dismiss(); if (engineActive && problem == null) runCatching { action(index) }.onFailure { Toast.makeText(this@PlayerActivity, "当前视频无法应用此设置", Toast.LENGTH_SHORT).show() } }
        }, LinearLayout.LayoutParams(-1, -2)) }
        dialog.setContentView(android.widget.ScrollView(this).apply { addView(column) }); dialog.setOnDismissListener { showControls(true) }; dialog.show()
    }
    private fun showSettingsMenu() {
        showControls(true); handler.removeCallbacks(hideControls)
        val column = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(8), dp(8), dp(8), dp(8)) }
        val scroll = android.widget.ScrollView(this).apply { addView(column) }
        val menu = PopupWindow(scroll, dp(224), -2, true).apply { elevation = dp(12).toFloat(); setBackgroundDrawable(GradientDrawable().apply { setColor(0xff1c2922.toInt()); cornerRadius = dp(12).toFloat() }); isOutsideTouchable = true; animationStyle = if (PlayerMotion.enabled) R.style.GenzoPlayerMenuAnimation else 0 }
        settingsMenu = menu
        fun item(title: String, needsMedia: Boolean = true, action: () -> Unit) {
            column.addView(TextView(this).apply {
                text = title; textSize = 14f; gravity = Gravity.CENTER_VERTICAL; setPadding(dp(12), 0, dp(12), 0); minimumHeight = dp(48); setTextColor(Color.WHITE)
                isEnabled = !needsMedia || (engineActive && problem == null); alpha = if (isEnabled) 1f else .4f
                background = android.graphics.drawable.RippleDrawable(ColorStateList.valueOf(0x334cc197), null, GradientDrawable().apply { setColor(Color.WHITE); cornerRadius = dp(6).toFloat() })
                setOnClickListener { menu.dismiss(); action() }
            }, LinearLayout.LayoutParams(-1, -2))
        }
        item("倍速                         ›") {
            val rates = listOf(.5f, .75f, 1f, 1.25f, 1.5f, 2f)
            showChoice("倍速", rates.map { "${it}×" }, rates.indexOf(player.rate)) { setPlaybackRate(rates[it]) }
        }
        item("超分辨率                  ›") { showChoice("Anime4K 超分辨率", listOf("关闭", "流畅档", "画质档"), superResolutionMode) { switchSuperResolution(it) } }
        item("音轨                         ›") { tracks(false) }
        item("字幕                         ›") { tracks(true) }
        item("选择外挂字幕") { if (subtitleSupported()) launchSubtitlePicker() }
        item("字幕偏移                  ›") { showChoice("字幕偏移", listOf("提前 500 ms", "重置", "延后 500 ms")) {
            subtitleDelayMs = if (it == 1) 0 else (subtitleDelayMs + if (it == 0) -500 else 500).coerceIn(-60000, 60000)
            check(player.setSpuDelay(subtitleDelayMs * 1000))
        } }
        item("视频详情", false) {
            val video = if (engineActive) "${player.property("video-params/w") ?: "—"} × ${player.property("video-params/h") ?: "—"}\n解码：${player.property("hwdec-current") ?: "—"}\n渲染：${player.property("current-vo") ?: "—"}" else "正在准备视频"
            AlertDialog.Builder(this).setTitle("视频详情").setMessage("${titleView.text}\n\n$video\n超分：${listOf("关闭", "流畅档", "画质档")[superResolutionMode]}").setPositiveButton("关闭", null).show()
        }
        item("开源说明", false) { showSuperResolutionLicenses() }
        menu.setOnDismissListener { settingsMenu = null; showControls(true) }
        menu.showAsDropDown(moreButton, -dp(176), 0)
    }

    private fun createEngine(mode: Int, paused: Boolean = false) {
        val generation = ++engineGeneration
        val stateChanged: (String, String?) -> Unit = { next, failure ->
            if (generation == engineGeneration && !isFinishing && !isDestroyed) {
                if (next == "playback_error") {
                    handler.post { if (generation == engineGeneration && !isFinishing && !isDestroyed) fail(failure ?: "playback_failed") }
                } else if (problem == null) {
                    status = next
                    if (next == "playing") showControls(true)
                    if (next in listOf("playing", "paused") && engineActive && player.length > 0) { playbackFailed = false; restorePlayback() }
                    report()
                }
            }
        }
        attemptRenderer = rendererOverride ?: playbackSettings.resolve(this, mode)
        attemptHardware = playbackSettings.hardware && !softwareOverride
        try {
            player = MpvEngine(this, mode, stateChanged, playbackSettings.copy(hardware = attemptHardware), attemptRenderer)
            engineActive = true
            viewport.addView(player.view, 0, FrameLayout.LayoutParams(-1, -1))
            startMedia(paused)
        } catch (_: LinkageError) { fail("player_unavailable") }
        catch (_: Exception) { fail("render_failed") }
    }

    private fun applyPlaybackSettings(settings: PlaybackSettings) {
        val normalized = settings.copy(renderer = if (settings.renderer == "compat") "auto" else settings.renderer)
        normalized.save(this); playbackSettings = normalized; rendererOverride = null; softwareOverride = false; recoveryAttempts.clear()
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
        pendingRate?.let { pendingRate = null; player.rate = it }
        // mpv loadfile already received the resume position; do not interrupt its first frame.
        resumeMs = 0
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
            softwareOverride = false; recoveryAttempts.clear(); problem = null; loadingError = null
            if (mode > 0 && playbackSettings.renderer == "mediacodec_embed") { playbackSettings = playbackSettings.copy(renderer = "gpu"); playbackSettings.save(this) }
            fallbackReason = null
            gpuError = null
            getSharedPreferences("genzo-player", 0).edit().putInt("anime4kMode", mode).apply()
        }
        if (!fallback && !rebuild && mode == superResolutionMode && engineActive) { report(); return }
        val paused = if (status == "opening") desiredPaused else (engineActive && !player.isPlaying && status != "buffering") || startOnResume
        if (engineActive) {
            resumeMs = player.time.takeIf { it > 0 } ?: lastPosition
            pendingRate = pendingRate ?: player.rate
            restoringTracks = Pair(player.audioTracks.indexOfFirst { it.id == player.audioTrack }, player.spuTracks.indexOfFirst { it.id == player.spuTrack })
        }
        restoreSidecar = selectedSidecar
        releaseEngine()
        superResolutionMode = mode
        status = "opening"; loadingMessage = "正在切换画面处理…"
        createEngine(mode, paused); report()
    }

    private fun releaseEngine() {
        engineGeneration++
        if (engineActive) {
            engineActive = false
            val old = player
            old.release(); viewport.removeView(old.view)
        }
        descriptor?.close(); descriptor = null
    }

    fun closeForReplacement() {
        status = "closed"; report()
        handler.removeCallbacksAndMessages(null)
        releaseEngine(); finish()
    }

    private fun fail(code: String) {
        if (isFinishing || isDestroyed || current?.get() !== this) return
        if (problem?.code in listOf("credential_invalid", "permission_denied", "source_missing") && code in listOf("source_offline", "playback_failed", "unsupported_media")) return
        playbackFailed = true
        val failure = PlaybackFailure.from(code)
        val details = JSObject().put("code", failure.code).put("sessionId", sessionId).put("timeMs", System.currentTimeMillis())
            .put("renderer", attemptRenderer).put("hardwareDecoding", attemptHardware).put("superResolution", superResolutionMode)
            .put("positionMs", lastPosition).put("recoveryAttempts", recoveryAttempts.joinToString(","))
        getSharedPreferences("genzo-player", 0).edit().putString("lastFailure", details.toString()).apply()
        val recovery = nextPlaybackRecovery(code, attemptRenderer, superResolutionMode, attemptHardware, recoveryAttempts)
        if (recovery != null) {
            recoveryAttempts.add(when { recovery.mode != superResolutionMode -> "no-shaders"; recovery.renderer != attemptRenderer -> "opengl"; else -> "software" })
            if (recovery.software) recoveryAttempts.add("software")
            rendererOverride = recovery.renderer; softwareOverride = recovery.software; fallbackReason = recovery.message; gpuError = code
            val generation = engineGeneration
            handler.post { if (generation == engineGeneration && !isFinishing && !isDestroyed) switchSuperResolution(recovery.mode, true, true) }
        } else {
            problem = failure; loadingError = failure.message; status = if (failure.code == "permission_denied") "permission_denied" else "playback_error"
            if (engineActive) player.pause()
        }
        report()
    }

    fun sourceFailure(expectedSession: String, code: String): Boolean {
        if (sessionId != expectedSession || isFinishing || isDestroyed || problem?.code == code) return false
        fail(code); return true
    }

    private fun retryPlayback() {
        problem = null; loadingError = null; recoveryAttempts.clear(); rendererOverride = null; softwareOverride = false
        resumeMs = lastPosition
        desiredPaused = false; status = "opening"
        switchSuperResolution(getSharedPreferences("genzo-player", 0).getInt("anime4kMode", 0).coerceIn(0, 2), true, true)
    }

    private fun showFailureDetails() {
        val details = getSharedPreferences("genzo-player", 0).getString("lastFailure", "{}").orEmpty()
        AlertDialog.Builder(this).setTitle("播放错误详情").setMessage(details)
            .setPositiveButton("复制详情") { _, _ ->
                (getSystemService(CLIPBOARD_SERVICE) as android.content.ClipboardManager).setPrimaryClip(android.content.ClipData.newPlainText("播放错误详情", details))
            }.setNegativeButton("关闭", null).show()
    }

    private fun startMedia(paused: Boolean = false) {
        desiredPaused = paused
        try {
            val locator = Uri.parse(uri)
            if (locator.scheme == "content") descriptor = contentResolver.openFileDescriptor(locator, "r") ?: throw IllegalStateException("Unreadable document")
            val background = !lifecycle.currentState.isAtLeast(androidx.lifecycle.Lifecycle.State.RESUMED)
            startOnResume = background && !paused
            player.open(uri, descriptor, resumeMs, paused || background)
        } catch (_: SecurityException) { fail("permission_denied") }
        catch (_: Exception) { fail("file_unavailable") }
    }

    private fun requireRuleSession(args: PlayerArgs) {
        require(!isFinishing && !isDestroyed && args.sessionId == sessionId && args.ruleOperation == ruleOperation && RuleResolver.allowed(ruleOperation))
    }

    fun updateRuleLoading(args: PlayerArgs) {
        requireRuleSession(args)
        require(!mediaReady)
        loadingMessage = args.loadingMessage
        if (args.loadingError) fail(args.loadingErrorCode)
        report()
    }

    fun acceptRuleMedia(args: PlayerArgs) {
        requireRuleSession(args)
        require(!mediaReady && Uri.parse(args.uri).scheme in listOf("http", "https", "content"))
        sourceKind = args.sourceKind
        uri = args.uri; mediaFileId = args.mediaFileId; resumeMs = args.resumeMs ?: 0
        initialSubtitle = args.subtitleUri
        intent.putExtra("subtitleFile", args.subtitleFile).putExtra("subtitleLabel", args.subtitleLabel).putExtra("subtitleId", args.subtitleId)
        mediaReady = true; loadingError = null; loadingMessage = "正在连接视频…"; status = "opening"
        createEngine(superResolutionMode)
        page.loadContext()
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
        player.rate = rate
    }

    fun control(args: ControlArgs): JSObject {
        require(args.sessionId == null || (args.sessionId == sessionId && !isFinishing && !isDestroyed))
        require((engineActive && problem == null) || args.action in listOf("close", "landscape", "portrait", "system", "retry", "playbackSettings"))
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
            "retry" -> { require(!ruleMedia && mediaReady); retryPlayback() }
            "close" -> { if (engineActive) player.pause(); status = "closed"; engineGeneration++; finish() }
            else -> throw IllegalArgumentException("Unknown action")
        }
        report()
        return snapshot
    }

    private fun report() {
        if (current?.get() !== this) return
        val active = if (engineActive) player else null
        if (active != null && active.length > 0 && status !in listOf("opening", "playback_error", "permission_denied")) {
            lastDuration = active.length; lastPosition = active.time.coerceIn(0, lastDuration)
        }
        lastReportMs = android.os.SystemClock.elapsedRealtime()
        fun trackList(items: Array<VideoTrack>?) = JSArray().apply {
            items?.forEach { put(JSObject().put("id", it.id).put("name", it.name)) }
        }
        val subtitleTracks = trackList(active?.spuTracks)
        sidecars.forEach { (id, entry) -> subtitleTracks.put(JSObject().put("id", id).put("name", entry.first).put("kind", "sidecar")) }
        snapshot = JSObject().put("status", status).put("engine", active?.name).put("positionMs", resumeMs.takeIf { status == "opening" && it > 0 } ?: lastPosition)
            .put("engineInitialized", engineActive).put("failed", playbackFailed)
            .put("loadingMessage", loadingMessage).put("ruleOperation", ruleOperation)
            .put("mediaFileId", mediaFileId).put("sessionId", sessionId).put("revision", ++revision)
            .put("updatedAtMs", System.currentTimeMillis())
            .put("durationMs", lastDuration).put("seekable", active?.isSeekable ?: false).put("rate", pendingRate ?: active?.rate ?: 1f)
            .put("audioTracks", trackList(active?.audioTracks)).put("subtitleTracks", subtitleTracks).put("selectedSidecar", selectedSidecar)
            .put("audioTrack", active?.audioTrack ?: -1).put("subtitleTrack", active?.spuTrack ?: -1).put("subtitleDelayUs", active?.spuDelay ?: 0)
            .put("subtitleOffsetMs", (active?.spuDelay ?: subtitleDelayMs * 1000) / 1000)
        snapshot.put("superResolution", superResolutionMode).put("superResolutionFallback", fallbackReason).put("gpuError", gpuError)
            .put("playbackSettings", JSObject().put("hardwareDecoding", playbackSettings.hardware).put("hardwareDecoder", playbackSettings.decoder).put("videoRenderer", playbackSettings.renderer))
        active?.let { mpv ->
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
        if (status != "closed") problem?.let { snapshot.put("error", JSObject().put("code", it.code).put("message", it.message).put("retryable", it.retryable)) }
        val loading = status in listOf("opening", "buffering", "playback_error", "permission_denied")
        val showTransport = mediaReady && engineActive && problem == null && status !in listOf("opening", "closed")
        if (transportShown != showTransport) { transportShown = showTransport; PlayerMotion.visibility(transport, showTransport); layoutLoading() }
        if ((loadingPanel.visibility == View.VISIBLE) != loading) PlayerMotion.visibility(loadingPanel, loading)
        loadingSpinner.visibility = if (loadingError != null || status == "playback_error") View.GONE else View.VISIBLE
        val loadingLabel = loadingError ?: if (status == "playback_error") "视频播放失败，请返回选集重试或切换线路。" else if (status == "buffering") "正在缓冲视频…" else loadingMessage
        if (loadingText.text.toString() != loadingLabel) loadingText.text = loadingLabel
        val retryLabel = if (ruleMedia || !mediaReady) "返回选集重试" else "重试播放"
        if (retryButton.text.toString() != retryLabel) retryButton.text = retryLabel
        retryButton.visibility = if (problem != null && (ruleMedia || !mediaReady || problem?.retryable == true)) View.VISIBLE else View.GONE
        detailsButton.visibility = if (problem != null) View.VISIBLE else View.GONE
        seek.isEnabled = mediaReady && engineActive && problem == null && active?.isSeekable == true
        playButton.isEnabled = mediaReady && engineActive && problem == null
        playButton.text = if (active?.isPlaying == true) "Ⅱ" else "▶"
        playButton.contentDescription = if (active?.isPlaying == true) "暂停" else "播放"
        fun time(ms: Long) = "${ms / 60000}:${((ms / 1000) % 60).toString().padStart(2, '0')}"
        val playbackLabel = "${time(lastPosition)} / ${time(lastDuration)}"
        if (label.text.toString() != playbackLabel) label.text = playbackLabel
        if (status != "playing" && !controlsVisible) showControls(true)
        if (lastDuration > 0 && !seek.isPressed) seek.progress = (lastPosition * 1000 / lastDuration).toInt().coerceIn(0, 1000)
        if (lastDuration > 0) getSharedPreferences("genzo-prototype-progress", 0).edit().putLong(identity(), lastPosition).apply()
        if (mediaFileId != null && lastDuration > 0) {
            getSharedPreferences("genzo-player", 0).edit().putString("lastProgress", snapshot.toString()).apply()
        }
    }

    override fun onStart() { super.onStart(); if (engineActive) player.onStart() }
    override fun finish() {
        super.finish()
        if (PlayerMotion.enabled) overridePendingTransition(R.anim.genzo_player_hold, R.anim.genzo_player_exit)
    }
    override fun onResume() { super.onResume(); if (startOnResume && engineActive && player.length > 0) { startOnResume = false; player.play() } }
    override fun onPause() {
        if (engineActive) player.pause()
        if (isFinishing) { status = "closed"; if (ruleOperation > 0) RuleResolver.cancel(ruleOperation) }
        else if (engineActive && status !in listOf("opening", "playback_error", "permission_denied")) status = "paused"
        report(); super.onPause()
    }
    override fun onStop() { if (engineActive) player.onStop(); super.onStop() }
    override fun onSaveInstanceState(outState: Bundle) { outState.putLong("positionMs", if (engineActive) player.time else lastPosition); super.onSaveInstanceState(outState) }
    override fun onDestroy() {
        if (ruleOperation > 0) RuleResolver.cancel(ruleOperation)
        subtitlePicker?.resolve(JSObject().put("status", "cancelled")); subtitlePicker = null
        settingsMenu?.dismiss(); handler.removeCallbacksAndMessages(null)
        if (::page.isInitialized) page.dispose()
        status = "closed"; report(); releaseEngine()
        subtitleFiles.forEach { it.delete() }
        if (current?.get() === this) current = null
        super.onDestroy()
    }
}
