package com.genzo.android

import android.app.Activity
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import java.io.ByteArrayInputStream

/** Isolated source-page renderer. It never receives the Tauri bridge or app credentials. */
object RuleResolver {
    // Kazumi uses desktop browser identities for both site requests and parsers.
    const val USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    private val main = Handler(Looper.getMainLooper())
    private var cancelCurrent: (() -> Unit)? = null
    @Volatile private var cancelledThrough: Long = 0
    @Volatile private var newestOperation: Long = 0
    fun allowed(operation: Long) = operation > cancelledThrough && operation >= newestOperation
    fun claim(operation: Long): Boolean {
        if (!allowed(operation)) return false
        newestOperation = operation; return true
    }
    fun cancel(operation: Long) { main.post {
        cancelledThrough = maxOf(cancelledThrough, operation)
        if (newestOperation <= cancelledThrough) cancelCurrent?.invoke()
    } }
    fun resolve(activity: Activity, url: String, legacy: Boolean, operation: Long, done: (JSONObject) -> Unit) {
        main.post {
            if (!claim(operation)) { done(JSONObject().put("error", "播放解析已取消")); return@post }
            cancelCurrent?.invoke()
            val view = WebView(activity)
            var finished = false
            val timeout = Runnable { cancelCurrent?.invoke() }
            fun finish(value: JSONObject) {
                val cleanup = Runnable {
                    if (!finished) {
                        finished = true; main.removeCallbacks(timeout); cancelCurrent = null
                        view.stopLoading(); view.removeJavascriptInterface("GenzoRuleVideo"); view.destroy(); done(value)
                    }
                }
                if (Looper.myLooper() == Looper.getMainLooper()) cleanup.run() else main.post(cleanup)
            }
            fun report(raw: String, referrer: String? = null) {
                if (finished || raw.length > 16384) return
                val resolved = try { java.net.URI(url).resolve(raw.trim()).toString() } catch (_: Exception) { return }
                val uri = Uri.parse(resolved)
                if (uri.scheme !in listOf("http", "https") || uri.host.isNullOrBlank() || !uri.userInfo.isNullOrBlank()) return
                if (listOf("googleads", "googlesyndication", "adtrafficquality", "prestrain").any { resolved.contains(it, true) }) return
                finish(JSONObject().put("url", resolved).put("referer", referrer ?: view.url ?: url))
            }
            fun legacyUrl(raw: String) {
                if (!legacy) return
                var current = raw
                repeat(5) {
                    val nested = try { Uri.parse(current).getQueryParameter("url") } catch (_: Exception) { null } ?: return
                    val decoded = if (nested.startsWith("http") || nested.startsWith("//")) nested else try {
                        String(android.util.Base64.decode(nested, android.util.Base64.DEFAULT), Charsets.UTF_8)
                    } catch (_: Exception) { nested }
                    if (decoded.startsWith("http") || decoded.startsWith("//")) { report(decoded); return }
                    current = decoded
                }
            }
            view.settings.apply {
                userAgentString = USER_AGENT
                javaScriptEnabled = true; domStorageEnabled = true
                allowFileAccess = false; allowContentAccess = false
                mediaPlaybackRequiresUserGesture = true
                loadsImagesAutomatically = false; blockNetworkImage = true
                setGeolocationEnabled(false); setSupportMultipleWindows(false)
                mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            }
            view.addJavascriptInterface(object {
                @JavascriptInterface fun found(value: String) { main.post {
                    try { val data = JSONObject(value); report(data.getString("url"), data.optString("referer")) }
                    catch (_: Exception) { report(value) }
                } }
                @JavascriptInterface fun frame(value: String) { main.post { legacyUrl(value) } }
            }, "GenzoRuleVideo")
            // Hooks follow Kazumi's Android parser (GPL-3.0, 2768c230), adapted
            // to a private Android interface and with a bounded renderer lifetime.
            val script = """
              (()=>{if(window.__genzoRuleHook)return;window.__genzoRuleHook=1;
                const found=u=>{try{if(u&&!String(u).startsWith('blob:'))GenzoRuleVideo.found(JSON.stringify({url:new URL(u,location.href).href,referer:location.href}))}catch{}};
                const text=Response.prototype.text;Response.prototype.text=function(){return text.call(this).then(s=>{if(s.trim().startsWith('#EXTM3U'))found(this.url);return s})};
                const open=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(...a){this.addEventListener('load',()=>{try{if(this.responseText.trim().startsWith('#EXTM3U'))found(a[1])}catch{}});return open.apply(this,a)};
                const scan=()=>{document.querySelectorAll('video,video source,audio source').forEach(v=>found(v.getAttribute('src')));document.querySelectorAll('iframe').forEach(f=>{try{GenzoRuleVideo.frame(new URL(f.getAttribute('src'),location.href).href)}catch{}})};
                const watch=()=>{scan();new MutationObserver(scan).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['src']})};
                if(document.documentElement)watch();else document.addEventListener('DOMContentLoaded',watch,{once:true});
              })();
            """.trimIndent()
            val documentStart = WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
            if (documentStart) WebViewCompat.addDocumentStartJavaScript(view, script, setOf("*"))
            view.webViewClient = object : WebViewClient() {
                override fun onPageStarted(v: WebView, address: String, icon: android.graphics.Bitmap?) { if (!documentStart) v.evaluateJavascript(script, null); legacyUrl(address) }
                override fun onPageFinished(v: WebView, address: String) { if (!documentStart) v.evaluateJavascript(script, null) }
                override fun shouldOverrideUrlLoading(v: WebView, request: WebResourceRequest): Boolean = request.url.scheme !in listOf("http", "https")
                override fun shouldInterceptRequest(v: WebView, request: WebResourceRequest): WebResourceResponse? {
                    val address = request.url.toString()
                    if (Regex("(?i)\\.(m3u8|mp4|mpd|flv|mkv|webm|mov|m4v)$").containsMatchIn(request.url.path.orEmpty())) {
                        main.post { report(address, request.requestHeaders["Referer"]) }
                        return WebResourceResponse("application/octet-stream", null, ByteArrayInputStream(ByteArray(0)))
                    }
                    return null
                }
            }
            view.setDownloadListener { address, _, _, mime, _ ->
                if (mime?.startsWith("video/") == true || mime?.contains("mpegurl") == true) report(address)
            }
            cancelCurrent = { finish(JSONObject().put("error", "解析已取消或超时，请重试或切换线路")) }
            main.postDelayed(timeout, 25000)
            view.loadUrl(url)
        }
    }
}
