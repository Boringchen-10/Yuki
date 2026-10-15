package com.genzo.android

import android.content.Context
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

internal object CommentTime {
    fun format(value: String, now: Long = System.currentTimeMillis()): String {
        val stamp = runCatching { Instant.parse(value).toEpochMilli() }.getOrElse {
            runCatching { LocalDateTime.parse(value.replace(' ', 'T')).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli() }.getOrNull()
        } ?: return value
        val seconds = ((now - stamp).coerceAtLeast(0) / 1000)
        return when {
            seconds < 60 -> "刚刚"
            seconds < 3600 -> "${seconds / 60}分钟前"
            seconds < 86400 -> "${seconds / 3600}小时前"
            seconds < 30L * 86400 -> "${seconds / 86400}天前"
            else -> Instant.ofEpochMilli(stamp).atZone(ZoneId.systemDefault()).format(DateTimeFormatter.ofPattern("yyyy年M月d日"))
        }
    }
}

internal object CommentImageSampling {
    fun sample(width: Int, height: Int, targetWidth: Int, targetHeight: Int, maxPixels: Long = 1_048_576): Int {
        var sample = 1
        while (sample < 128 && (width / sample > targetWidth || height / sample > targetHeight || width.toLong() * height / sample / sample > maxPixels)) sample *= 2
        return sample
    }
}

internal object CommentImageMarkup {
    data class Part(val value: String, val image: Boolean = false)
    private val pattern = Regex("\\[img(?:=[^\\]]*)?\\]\\s*((?:https?:)?//[^\\s\\[\\]]+)\\s*\\[/img\\]", RegexOption.IGNORE_CASE)
    fun parts(value: String): List<Part> {
        val result = mutableListOf<Part>()
        var end = 0
        pattern.findAll(value).take(4).forEach { match ->
            if (match.range.first > end) result.add(Part(value.substring(end, match.range.first)))
            val source = match.groupValues[1]
            val url = if (source.startsWith("//")) "https:$source" else source.replaceFirst(Regex("^http://", RegexOption.IGNORE_CASE), "https://")
            result.add(Part(url, true))
            end = match.range.last + 1
        }
        if (end < value.length) result.add(Part(value.substring(end)))
        return result
    }
}

/** Shared comment identity; images remain supplied by the existing private Rust routes. */
internal class CommentViews(private val context: Context, private val foreground: Int, private val muted: Int,
    private val image: (ImageView, String, Int) -> Unit) {
    private fun dp(value: Int) = (value * context.resources.displayMetrics.density).toInt()
    private fun text(value: String, size: Float, color: Int = foreground) = TextView(context).apply { text = value; textSize = size; setTextColor(color) }
    fun identity(item: JSONObject, timeField: String = "createdAt", compact: Boolean = false): LinearLayout {
        val name = item.optString("userName").ifBlank { "匿名用户" }
        val row = LinearLayout(context).apply { gravity = Gravity.CENTER_VERTICAL }
        val size = dp(if (compact) 32 else 40)
        val avatar = FrameLayout(context)
        avatar.addView(text(name.take(1), 16f, muted).apply { gravity = Gravity.CENTER }, FrameLayout.LayoutParams(-1, -1))
        val picture = ImageView(context).apply {
            scaleType = ImageView.ScaleType.CENTER_CROP; contentDescription = "$name 头像"
            background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(0x22288888) }; clipToOutline = true
        }
        avatar.addView(picture, FrameLayout.LayoutParams(-1, -1))
        row.addView(avatar, LinearLayout.LayoutParams(size, size).apply { rightMargin = dp(10) })
        val labels = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
        labels.addView(text(name, if (compact) 12f else 14f).apply { setTypeface(typeface, Typeface.BOLD); maxLines = 2 })
        val time = text(CommentTime.format(item.optString(timeField)), if (compact) 11f else 12f, muted)
        if (!compact) labels.addView(time)
        row.addView(labels, LinearLayout.LayoutParams(0, -2, 1f))
        if (compact) row.addView(time, LinearLayout.LayoutParams(-2, -2).apply { leftMargin = dp(8) })
        item.optString("userAvatar").takeIf { it.isNotBlank() && it != "null" }?.let { image(picture, it, size) }
        return row
    }
    fun body(value: String): LinearLayout {
        val column = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
        CommentImageMarkup.parts(value).forEach { part ->
            if (part.image) {
                val frame = FrameLayout(context)
                val picture = ImageView(context).apply { adjustViewBounds = true; scaleType = ImageView.ScaleType.FIT_CENTER; minimumHeight = dp(80); maxHeight = context.resources.displayMetrics.heightPixels * 2; contentDescription = "评论图片" }
                frame.addView(picture, FrameLayout.LayoutParams(-1, -2))
                frame.addView(text("图片加载中…", 13f, muted).apply { tag = "comment-image-status"; gravity = Gravity.CENTER }, FrameLayout.LayoutParams(-1, dp(80)))
                column.addView(frame, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(10) })
                image(picture, part.value, context.resources.displayMetrics.widthPixels - dp(72))
            } else if (part.value.isNotBlank()) {
                column.addView(text(part.value.trim(), 14f).apply { setTextIsSelectable(true); setPadding(0, dp(10), 0, dp(4)) })
            }
        }
        return column
    }
}
