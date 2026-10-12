package com.genzo.android

import android.animation.ValueAnimator
import android.view.View
import android.view.animation.DecelerateInterpolator

internal object PlayerMotion {
    val enabled get() = ValueAnimator.areAnimatorsEnabled()
    fun visibility(view: View, visible: Boolean) {
        view.animate().cancel()
        if (!enabled) { view.alpha = 1f; view.visibility = if (visible) View.VISIBLE else View.GONE; return }
        if (visible) {
            if (view.visibility != View.VISIBLE) view.alpha = 0f
            view.visibility = View.VISIBLE
        }
        view.animate().alpha(if (visible) 1f else 0f).setDuration(160).setInterpolator(DecelerateInterpolator())
            .withEndAction { if (!visible) view.visibility = View.GONE }.start()
    }
    fun swap(view: View, change: () -> Unit) {
        view.animate().cancel()
        if (!enabled) { change(); view.alpha = 1f; view.translationY = 0f; return }
        val distance = 6 * view.resources.displayMetrics.density
        view.animate().alpha(0f).translationY(distance / 2).setDuration(70).withEndAction {
            change(); view.translationY = distance
            view.animate().alpha(1f).translationY(0f).setDuration(160).setInterpolator(DecelerateInterpolator()).withEndAction(null).start()
        }.start()
    }
    fun enter(view: View) {
        view.animate().cancel(); view.translationY = 0f
        if (!enabled) { view.alpha = 1f; return }
        view.alpha = 0f
        view.animate().alpha(1f).setDuration(180).withEndAction(null).start()
    }
    fun color(view: android.widget.TextView, color: Int) {
        if (view.currentTextColor == color) return
        if (!enabled) { view.setTextColor(color); return }
        android.animation.ObjectAnimator.ofArgb(view, "textColor", view.currentTextColor, color).apply {
            setAutoCancel(true); duration = 160; start()
        }
    }
}
