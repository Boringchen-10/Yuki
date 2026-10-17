package com.genzo.android

import android.app.Activity
import android.os.Bundle
import android.graphics.Color
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.WebResourceRequest
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONObject

/** User-visible site verification, isolated from the app's business WebView. */
class RuleVerificationActivity : Activity() {
    private var browser: WebView? = null
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val url = intent.getStringExtra("url") ?: run { finish(); return }
        val uri = android.net.Uri.parse(url)
        if (uri.scheme !in listOf("http", "https") || !uri.userInfo.isNullOrBlank()) { finish(); return }
        val layout = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.rgb(13,20,19)) }
        androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(layout) { view, insets ->
            val bars = insets.getInsets(androidx.core.view.WindowInsetsCompat.Type.systemBars() or androidx.core.view.WindowInsetsCompat.Type.displayCutout())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom); insets
        }
        layout.addView(TextView(this).apply { text = "完成来源网站的验证后，返回应用重试搜索"; setTextColor(Color.WHITE); textSize = 16f; setPadding(12,12,12,12) })
        layout.addView(Button(this).apply { text = "完成验证，返回 Yuki"; setOnClickListener { android.webkit.CookieManager.getInstance().flush(); finish() } })
        val view = WebView(this); browser = view
        view.settings.apply { userAgentString = RuleResolver.USER_AGENT; javaScriptEnabled = true; domStorageEnabled = true; allowFileAccess = false; allowContentAccess = false; setGeolocationEnabled(false) }
        val anti = try { JSONObject(intent.getStringExtra("config") ?: "{}") } catch (_: Exception) { JSONObject() }
        var injected = false
        view.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(v: WebView, request: WebResourceRequest): Boolean = request.url.scheme !in listOf("http", "https")
            override fun onPageFinished(v: WebView, address: String) {
                if (injected) return
                injected = true
                if (anti.optInt("captchaType", 1) == 2 && anti.optString("captchaButton").isNotBlank()) {
                    val expression = JSONObject.quote(anti.optString("captchaButton"))
                    v.evaluateJavascript("try { document.evaluate($expression,document,null,9,null).singleNodeValue?.click() } catch {}", null)
                } else if (anti.optInt("captchaType", 1) == 3) {
                    val script = anti.optString("captchaScript"); if (script.length <= 32768) v.evaluateJavascript(script, null)
                }
            }
        }
        layout.addView(view, LinearLayout.LayoutParams(-1,0,1f)); setContentView(layout)
        val method = intent.getStringExtra("method") ?: "GET"
        val body = intent.getStringExtra("body") ?: ""
        if (method == "POST") view.postUrl(url, body.toByteArray(Charsets.UTF_8)) else view.loadUrl(url)
    }
    override fun onDestroy() { browser?.stopLoading(); browser?.destroy(); browser = null; super.onDestroy() }
}
