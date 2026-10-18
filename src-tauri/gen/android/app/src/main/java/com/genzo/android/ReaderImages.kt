package com.genzo.android

import android.app.Dialog
import android.content.res.ColorStateList
import android.graphics.Color
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.core.view.WindowCompat
import androidx.core.graphics.ColorUtils
import androidx.lifecycle.lifecycleScope
import com.davemorrissey.labs.subscaleview.ImageSource
import com.davemorrissey.labs.subscaleview.SubsamplingScaleImageView
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/**
 * Full-screen page view opened by double-tapping a comic page or a novel illustration.
 *
 * Saving writes to the system gallery; the dialog stays open so the reader can keep
 * looking at the page. The save button is the only filled control here: rotating,
 * resetting and leaving are adjustments, saving is the action that leaves the app.
 */
fun showReaderImage(host: ReaderActivity, file: File, name: String = "Yuki 图片", dismissed: () -> Unit = {}) {
    val root = LinearLayout(host).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(host.readerBackground); gravity = Gravity.CENTER }
    val image = SubsamplingScaleImageView(host).apply { setMaxScale(10f); setDoubleTapZoomScale(2.5f); setImage(ImageSource.uri(file.absolutePath)) }
    root.addView(image,LinearLayout.LayoutParams(-1,0,1f))
    val controls = LinearLayout(host)
    val dialog = Dialog(host, R.style.Theme_genzo)
    var saving = false
    var dismissPending = false
    // Deferred so a page still being written is never deleted by the dismissed() cleanup.
    fun leave() { if (saving) dismissPending = true else dismissed() }

    lateinit var saveButton: Button
    val startSave = {
        if (!saving) {
            saving = true
            saveButton.isEnabled = false
            saveButton.alpha = 0.6f
            saveButton.text = "保存中…"
            host.lifecycleScope.launch {
                val saved = withContext(Dispatchers.IO) { ReaderGallery.save(host, file, name) }
                saving = false
                if (dialog.isShowing) {
                    saveButton.isEnabled = true
                    saveButton.alpha = 1f
                    saveButton.text = "保存"
                }
                host.notify(if (saved) "已保存到相册" else "保存失败，请重试")
                if (dismissPending) { dismissPending = false; dismissed() }
            }
        }
    }
    saveButton = host.button("保存") {
        if (ReaderGallery.needsStoragePermission(host)) host.requestGallerySave { startSave() } else startSave()
    }.apply {
        backgroundTintList = ColorStateList.valueOf(host.accent)
        setTextColor(Color.rgb(4, 32, 26))
        contentDescription = "保存到相册"
    }
    controls.addView(saveButton,LinearLayout.LayoutParams(0,host.dp(48),1f))
    controls.addView(host.button("旋转") { image.setOrientation((image.orientation + 90) % 360) },LinearLayout.LayoutParams(0,host.dp(48),1f))
    controls.addView(host.button("重置") { image.setOrientation(0); image.resetScaleAndCenter() },LinearLayout.LayoutParams(0,host.dp(48),1f))
    controls.addView(host.button("返回") { dialog.dismiss() },LinearLayout.LayoutParams(0,host.dp(48),1f))
    root.addView(controls)
    ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
        val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
        view.setPadding(bars.left,bars.top,bars.right,bars.bottom); insets
    }
    val observer = object : androidx.lifecycle.DefaultLifecycleObserver {
        override fun onDestroy(owner: androidx.lifecycle.LifecycleOwner) { dialog.dismiss(); host.lifecycle.removeObserver(this) }
    }
    host.lifecycle.addObserver(observer)
    dialog.setContentView(root); dialog.setOnDismissListener { host.lifecycle.removeObserver(observer); image.recycle(); leave() }; dialog.show()
    dialog.window?.let { window ->
        window.setLayout(-1,-1)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, root).apply {
            isAppearanceLightStatusBars = ColorUtils.calculateLuminance(host.readerBackground) > .5
            isAppearanceLightNavigationBars = isAppearanceLightStatusBars
        }
        ViewCompat.requestApplyInsets(root)
    }
}
