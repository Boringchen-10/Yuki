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

/** Settings expand inside one scrollable surface, including long track lists. */
internal class PlayerSettingsMenu(private val anchor: View, private val items: List<PlayerMenuItem>, onDismiss: () -> Unit) {
    private val context = anchor.context
    private fun dp(value: Int) = (value * context.resources.displayMetrics.density).toInt()
    private val frame = FrameLayout(context).apply { clipChildren = false; clipToPadding = false; isFocusableInTouchMode = true }
    private val main = panel()
    private var child: LinearLayout? = null
    private var expandedHeader: TextView? = null
    private var popupTop: Int? = null
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
        items.forEach { item ->
            val group = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
            val header = row(item).apply {
                if (item.children.isNotEmpty()) {
                    setCompoundDrawablesWithIntrinsicBounds(0, 0, R.drawable.ic_genzo_arrow_right, 0)
                    compoundDrawablePadding = dp(4)
                }
                setOnClickListener {
                    if (item.children.isEmpty()) { dismiss(); item.action() }
                    else if (expandedHeader === this) closeChild()
                    else expand(item, this, group)
                }
            }
            group.addView(header, LinearLayout.LayoutParams(-1, -2))
            column.addView(group, LinearLayout.LayoutParams(-1, -2))
        }
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
    private fun expand(item: PlayerMenuItem, header: TextView, group: LinearLayout) {
        removeChild()
        expandedHeader = header
        header.setCompoundDrawablesWithIntrinsicBounds(0, 0, R.drawable.ic_genzo_arrow_down, 0)
        child = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(0x22000000)
            item.children.forEach { choice -> addView(row(choice).apply {
                setPadding(dp(24), dp(8), dp(8), dp(8))
                setOnClickListener { dismiss(); choice.action() }
            }, LinearLayout.LayoutParams(-1, -2)) }
        }
        group.addView(child, LinearLayout.LayoutParams(-1, -2))
        position(); PlayerMotion.enter(requireNotNull(child)); frame.requestFocus()
        main.post { if (expandedHeader === header) main.smoothScrollTo(0, group.top) }
    }
    private fun position() {
        val bounds = Rect(); anchor.getWindowVisibleDisplayFrame(bounds)
        val gap = dp(8)
        val mainWidth = minOf(dp(224), bounds.width() - gap * 2)
        main.measure(View.MeasureSpec.makeMeasureSpec(mainWidth, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(bounds.height() - gap * 2, View.MeasureSpec.AT_MOST))
        val location = IntArray(2); anchor.getLocationOnScreen(location)
        val top = popupTop ?: (if (location[1] > bounds.centerY()) location[1] - main.measuredHeight else location[1] + anchor.height)
            .coerceIn(bounds.top + gap, bounds.bottom - main.measuredHeight - gap).also { popupTop = it }
        main.measure(View.MeasureSpec.makeMeasureSpec(mainWidth, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(bounds.bottom - top - gap, View.MeasureSpec.AT_MOST))
        main.layoutParams = FrameLayout.LayoutParams(mainWidth, main.measuredHeight)
        val right = (location[0] + anchor.width).coerceIn(bounds.left + mainWidth + gap, bounds.right - gap)
        if (popup.isShowing) popup.update(right - mainWidth, top, mainWidth, main.measuredHeight)
        else { popup.width = mainWidth; popup.height = main.measuredHeight; popup.showAtLocation(anchor, Gravity.TOP or Gravity.LEFT, right - mainWidth, top) }
    }
    fun show() {
        position(); frame.requestFocus()
    }
    fun back(): Boolean {
        if (!isShowing) return false
        if (child != null) closeChild() else dismiss()
        return true
    }
    private fun removeChild() {
        child?.let { (it.parent as LinearLayout).removeView(it) }; child = null
        expandedHeader?.setCompoundDrawablesWithIntrinsicBounds(0, 0, R.drawable.ic_genzo_arrow_right, 0)
        expandedHeader = null
    }
    private fun closeChild() { removeChild(); position() }
    fun dismiss() { closing = true; popup.dismiss() }
}
