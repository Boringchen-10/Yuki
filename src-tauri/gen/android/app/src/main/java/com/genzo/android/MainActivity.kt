package com.genzo.android

import android.os.Bundle
import android.os.SystemClock
import androidx.activity.enableEdgeToEdge
import androidx.activity.OnBackPressedCallback
import androidx.core.content.ContextCompat
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import android.webkit.WebView
import android.view.View

class MainActivity : TauriActivity() {
  private var webView: WebView? = null
  private var lastInsets: WindowInsetsCompat? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    val splashScreen = installSplashScreen()
    val splashStart = SystemClock.uptimeMillis()
    // Keep the branded launch screen on screen long enough to read, then hand off to the app.
    splashScreen.setKeepOnScreenCondition { SystemClock.uptimeMillis() - splashStart < 800 }
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
        val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
        val keyboard = insets.getInsets(WindowInsetsCompat.Type.ime())
        // Web backgrounds extend under the status bar; CSS keeps interactive content inside its inset.
        view.setPadding(bars.left, 0, bars.right, keyboard.bottom)
        lastInsets = insets
        publishSafeInsets(insets)
        insets
    }
    ViewCompat.requestApplyInsets(content)
  }

  private fun publishSafeInsets(insets: WindowInsetsCompat) {
    val view = webView ?: return
    val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
    val bottom = bars.bottom / resources.displayMetrics.density
    val top = bars.top / resources.displayMetrics.density
    view.post { view.evaluateJavascript("document.documentElement.style.setProperty('--safe-top','${top}px');document.documentElement.style.setProperty('--safe-bottom','${bottom}px')", null) }
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    this.webView = webView
    lastInsets?.let { publishSafeInsets(it) }
    webView.setBackgroundColor(ContextCompat.getColor(this, R.color.genzo_splash_background))
    WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        webView.evaluateJavascript("Boolean(window.__genzoBack && window.__genzoBack())") { handled ->
          if (handled != "true") {
            isEnabled = false
            onBackPressedDispatcher.onBackPressed()
            isEnabled = true
          }
        }
      }
    })
  }
}
