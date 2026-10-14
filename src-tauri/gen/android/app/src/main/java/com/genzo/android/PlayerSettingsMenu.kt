package com.genzo.android

import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Rect
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.text.TextUtils
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.PopupWindow
import android.widget.ScrollView
import android.widget.TextView

internal data class PlayerMenuItem(val label: String, val enabled: Boolean = true, val selected: Boolean = false,
    val children: List<PlayerMenuItem> = emptyList(), val action: () -> Unit = {})

/** One focusable window keeps the parent and its adjacent submenu open together. */
internal class PlayerSettingsMenu(private val anchor: View, private val items: List<PlayerMenuItem>, onDismiss: () -> Unit) {
    private val context = anchor.context
    private fun dp(value: Int) = (value * context.resources.displayMetrics.density).toInt()
    private val frame = FrameLayout(context).apply { clipChildren = false; clipToPadding = false; isFocusableInTouchMode = true }
    private val main = panel()
    private var child: ScrollView? = null
    private var closing = false
    private val popup = object : PopupWindow(frame, -2, -2, true) {
        override fun dismiss() {
            // Android's popup back callback bypasses the content view's key listener.
            if (!closing && child != null) closeChild() else super.dismiss()
        }
    }.apply {
        setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT)); isOutsideTouchable = true
        animationStyle = if (PlayerMotion.enabled) R.style.GenzoPlayerMenuAnimation else 0
        setOnDismissListener { onDismiss() }
        setTouchInterceptor { _, event ->
            if (event.action == MotionEvent.ACTION_OUTSIDE || event.action == MotionEvent.ACTION_DOWN && (event.x < 0 || event.y < 0 || event.x >= width || event.y >= height)) closing = true
            false
        }
    }
    val isShowing get() = popup.isShowing

    init {
        val column = main.getChildAt(0) as LinearLayout
        items.forEach { item -> column.addView(row(item).apply {
            if (item.children.isNotEmpty()) {
                setCompoundDrawablesWithIntrinsicBounds(0, 0, R.drawable.ic_genzo_arrow_right, 0)
                compoundDrawablePadding = dp(4)
            }
            setOnClickListener {
                if (item.children.isEmpty()) { dismiss(); item.action() }
                else expand(item, this)
            }
        }, LinearLayout.LayoutParams(-1, -2)) }
        frame.addView(main)
    }
    private fun panel() = ScrollView(context).apply {
        isVerticalScrollBarEnabled = false; elevation = dp(12).toFloat()
        background = GradientDrawable().apply { setColor(0xff1c2922.toInt()); cornerRadius = dp(8).toFloat() }
        addView(LinearLayout(context).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(6), dp(6), dp(6), dp(6)) })
    }
    private fun row(item: PlayerMenuItem) = TextView(context).apply {
        text = item.label; contentDescription = item.label; textSize = 14f; gravity = Gravity.CENTER_VERTICAL
        setPadding(dp(12), dp(8), dp(8), dp(8)); minimumHeight = dp(48); maxLines = 2; ellipsize = TextUtils.TruncateAt.END
        isEnabled = item.enabled; isSelected = item.selected; alpha = if (item.enabled) 1f else .4f
        setTextColor(if (item.selected) 0xff4cc197.toInt() else Color.WHITE)
        background = RippleDrawable(ColorStateList.valueOf(0x334cc197),
            if (item.selected) ColorDrawable(0x224cc197) else null, ColorDrawable(Color.WHITE))
    }
    private fun expand(item: PlayerMenuItem, selected: View) {
        child?.let { frame.removeView(it) }
        child = panel().also { panel ->
            val column = panel.getChildAt(0) as LinearLayout
            item.children.forEach { choice -> column.addView(row(choice).apply {
                setOnClickListener { dismiss(); choice.action() }
            }, LinearLayout.LayoutParams(-1, -2)) }
            frame.addView(panel)
        }
        val location = IntArray(2); selected.getLocationOnScreen(location)
        position(location[1]); PlayerMotion.enter(requireNotNull(child)); frame.requestFocus()
    }
    private fun position(rowY: Int? = null) {
        val bounds = Rect(); anchor.getWindowVisibleDisplayFrame(bounds)
        val gap = dp(8); val maxHeight = bounds.height() - gap * 2
        val mainWidth = minOf(dp(184), bounds.width() - gap * 2)
        main.measure(View.MeasureSpec.makeMeasureSpec(mainWidth, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(maxHeight, View.MeasureSpec.AT_MOST))
        val location = IntArray(2); anchor.getLocationOnScreen(location)
        val top = (location[1] + anchor.height).coerceIn(bounds.top + gap, bounds.bottom - main.measuredHeight - gap)
        val childWidth = if (child == null) 0 else minOf(dp(164), bounds.width() - mainWidth - gap * 3)
        var height = main.measuredHeight
        child?.let { panel ->
            val availableHeight = bounds.bottom - top - gap
            panel.measure(View.MeasureSpec.makeMeasureSpec(childWidth, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(availableHeight, View.MeasureSpec.AT_MOST))
            val offset = ((rowY ?: top) - top).coerceIn(0, availableHeight - panel.measuredHeight)
            panel.layoutParams = FrameLayout.LayoutParams(childWidth, panel.measuredHeight).apply { topMargin = offset }
            height = maxOf(height, offset + panel.measuredHeight)
        }
        val width = mainWidth + if (child != null) childWidth + gap else 0
        main.layoutParams = FrameLayout.LayoutParams(mainWidth, main.measuredHeight, Gravity.TOP or Gravity.RIGHT)
        val right = (location[0] + anchor.width).coerceIn(bounds.left + width + gap, bounds.right - gap)
        if (popup.isShowing) popup.update(right - width, top, width, height)
        else { popup.width = width; popup.height = height; popup.showAtLocation(anchor, Gravity.TOP or Gravity.LEFT, right - width, top) }
    }
    fun show(submenu: String? = null) {
        position(); frame.requestFocus()
        if (submenu != null) {
            val index = items.indexOfFirst { it.label == submenu && it.enabled && it.children.isNotEmpty() }
            if (index >= 0) main.post { expand(items[index], (main.getChildAt(0) as LinearLayout).getChildAt(index)) }
        }
    }
    fun back(): Boolean {
        if (!isShowing) return false
        if (child != null) closeChild() else dismiss()
        return true
    }
    private fun closeChild() { child?.let { frame.removeView(it) }; child = null; position() }
    fun dismiss() { closing = true; popup.dismiss() }
}
