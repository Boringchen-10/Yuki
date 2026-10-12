package com.genzo.android

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.text.TextUtils
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.recyclerview.widget.GridLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.bottomsheet.BottomSheetDialog
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** Portrait business panel. Data comes through the existing Tauri native bridge. */
class PlayerPage(context: Context, private val session: String?, private val mediaId: () -> String?) : LinearLayout(context) {
    val accent = Color.rgb(76, 193, 151)
    private val foregroundColor = Color.rgb(230, 235, 231)
    private val muted = Color.rgb(143, 158, 150)
    private val surface = Color.rgb(24, 35, 30)
    private val requests = java.util.ArrayDeque<JSONObject>()
    private var sequence = 0L
    private var contextRequest = 0L
    private var disposed = false
    private var data = JSONObject()
    private var allRows = listOf<JSONObject>()
    private var visibleRows = listOf<JSONObject>()
    private val comments = mutableListOf<JSONObject>()
    private val imagePaths = mutableMapOf<String, String>()
    private val requestedImages = mutableSetOf<String>()
    private val shownImages = mutableSetOf<String>()
    private val bitmaps = object : android.util.LruCache<String, android.graphics.Bitmap>(8 * 1024 * 1024) {
        override fun sizeOf(key: String, value: android.graphics.Bitmap) = value.allocationByteCount
    }
    private val images = java.util.concurrent.ThreadPoolExecutor(2, 2, 0L, java.util.concurrent.TimeUnit.MILLISECONDS, java.util.concurrent.ArrayBlockingQueue(12), java.util.concurrent.ThreadPoolExecutor.DiscardOldestPolicy())
    private var selectedSource = ""
    private var selectedTab = "episodes"
    private var commentsLoading = false
    private var commentsLoaded = false
    private var commentsTotal = 0
    private var playing = false
    private val tabs = LinearLayout(context)
    private val episodesTab = tab("选集") { selectTab("episodes") }
    private val commentsTab = tab("评论") { selectTab("comments") }
    private val title = text("正在读取播放资料…", 21f, true)
    private val source = text("播放来源", 15f, true)
    private val summary = text("", 13f)
    private val message = text("", 14f)
    private val retry = text("重试", 14f, true)
    private val more = text("加载更多评论", 14f, true)
    private val grid = GridLayoutManager(context, 2)
    private val list = RecyclerView(context)
    private val adapter = RowsAdapter()

    init {
        orientation = VERTICAL; setBackgroundColor(Color.rgb(13, 22, 18)); setPadding(dp(16), 0, dp(16), 0)
        commentsTab.isEnabled = false
        title.maxLines = 2; title.ellipsize = TextUtils.TruncateAt.END
        source.maxLines = 2; source.ellipsize = TextUtils.TruncateAt.END
        tabs.gravity = Gravity.CENTER; tabs.addView(episodesTab, LayoutParams(0, dp(52), 1f)); tabs.addView(commentsTab, LayoutParams(0, dp(52), 1f)); addView(tabs)
        addView(title, LayoutParams(-1, -2).apply { topMargin = dp(12); bottomMargin = dp(16) })
        source.setPadding(dp(16), dp(16), dp(16), dp(16)); source.background = shape(surface, 16); source.foreground = ripple(); source.setOnClickListener { chooseSource() }
        addView(source, LayoutParams(-1, -2)); addView(summary, LayoutParams(-1, dp(44)))
        message.gravity = Gravity.CENTER; message.setPadding(dp(8), dp(12), dp(8), dp(12)); addView(message)
        retry.gravity = Gravity.CENTER; retry.setTextColor(accent); retry.foreground = ripple(); retry.minimumHeight = dp(48); retry.setOnClickListener { if (selectedTab == "comments") loadComments() else loadContext() }; addView(retry)
        list.layoutManager = grid; list.adapter = adapter; list.clipToPadding = false; list.setPadding(0, 0, 0, dp(16)); list.itemAnimator = null
        addView(list, LayoutParams(-1, 0, 1f))
        more.gravity = Gravity.CENTER; more.setTextColor(accent); more.foreground = ripple(); more.minimumHeight = dp(48); more.setOnClickListener { loadComments(comments.size) }; addView(more)
        render(); loadContext()
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
    private fun shape(color: Int, radius: Int) = GradientDrawable().apply { setColor(color); cornerRadius = dp(radius).toFloat() }
    private fun text(value: String, size: Float, bold: Boolean = false) = TextView(context).apply {
        text = value; textSize = size; setTextColor(foregroundColor); gravity = Gravity.CENTER_VERTICAL
        if (bold) setTypeface(typeface, Typeface.BOLD)
    }
    private fun ripple() = android.graphics.drawable.RippleDrawable(ColorStateList.valueOf(0x334cc197), null, shape(Color.WHITE, 12))
    private fun tab(label: String, action: () -> Unit) = text(label, 15f, true).apply { gravity = Gravity.CENTER; background = ripple(); setOnClickListener { action() } }

    private fun request(action: String, extra: JSONObject = JSONObject()): Boolean {
        val value = JSONObject(extra.toString()).put("id", ++sequence).put("action", action).put("sessionId", session).put("mediaFileId", mediaId())
        if (action == "context") contextRequest = sequence
        if (action in listOf("play", "comments", "context")) requests.addFirst(value) else if (requests.size < 32) requests.addLast(value) else return false
        return true
    }
    fun takeRequest(): JSONObject? = if (disposed) null else requests.pollFirst()
    fun loadContext() { message.text = "正在读取剧集…"; message.visibility = VISIBLE; retry.visibility = GONE; request("context") }
    fun accept(channel: String, value: JSONObject, requestId: Long) {
        if (disposed) return
        if (channel == "context" && requestId != contextRequest) return
        when (channel) {
            "context" -> {
                if (value.has("error")) { message.text = value.optString("error"); message.visibility = VISIBLE; retry.visibility = VISIBLE; return }
                data = value; title.text = value.optString("title", "视频播放")
                allRows = objects(value.optJSONArray("rows")); selectedSource = value.optString("selectedSource")
                allRows.forEach { row -> row.optString("imagePath").takeIf { it.isNotBlank() }?.let { imagePaths[row.optString("episodeKey")] = it } }
                commentsTab.isEnabled = true; message.text = ""; retry.visibility = GONE; render()
            }
            "comments" -> {
                commentsLoading = false
                if (value.has("error")) { if (selectedTab == "comments") { message.text = value.optString("error"); retry.visibility = VISIBLE } }
                else {
                    if (value.optInt("offset") == 0) comments.clear()
                    val existing = comments.map { it.optString("id") }.toSet()
                    comments.addAll(objects(value.optJSONArray("items")).filter { it.optString("id") !in existing })
                    commentsTotal = value.optInt("total"); commentsLoaded = true
                    if (selectedTab == "comments") { message.text = if (comments.isEmpty()) "Bangumi 暂无条目评论" else ""; retry.visibility = GONE }
                }
                render()
            }
            "image" -> { value.optString("path").takeIf { it.isNotBlank() && it != "null" }?.let {
                val key = value.optString("episodeKey"); imagePaths[key] = it
                if (selectedTab == "episodes") visibleRows.forEachIndexed { index, row -> if (row.optString("episodeKey") == key) adapter.notifyItemChanged(index) }
            } }
            "play" -> { playing = false; if (value.has("error")) { message.text = value.optString("error"); retry.visibility = GONE }; adapter.notifyDataSetChanged() }
        }
    }

    private fun objects(array: JSONArray?): List<JSONObject> = if (array == null) emptyList() else (0 until array.length()).mapNotNull { array.optJSONObject(it) }
    private fun selectTab(tab: String) {
        if (tab == selectedTab) return
        PlayerMotion.swap(list) {
            selectedTab = tab; message.text = ""; retry.visibility = GONE
            if (tab == "comments" && !commentsLoaded && !commentsLoading) loadComments()
            render()
        }
    }
    private fun loadComments(offset: Int = 0) {
        if (!data.optBoolean("hasBangumi")) { message.text = "此视频尚未关联 Bangumi，暂无条目评论"; return }
        if (commentsLoading) return
        commentsLoading = true; message.text = if (offset == 0) "正在读取 Bangumi 评论…" else ""; retry.visibility = GONE
        request("comments", JSONObject().put("offset", offset)); render()
    }
    private fun chooseSource() {
        val options = linkedMapOf<String, String>()
        allRows.forEach { row -> row.optString("sourceId").takeIf { it.isNotBlank() && it != "null" }?.let { options[it] = row.optString("sourceLabel", "播放来源") } }
        if (options.isEmpty()) return
        val dialog = BottomSheetDialog(context); val column = LinearLayout(context).apply { orientation = VERTICAL; setPadding(dp(16), dp(16), dp(16), dp(24)); setBackgroundColor(surface) }
        column.addView(text("播放来源与线路", 18f, true), LayoutParams(-1, dp(48)))
        options.forEach { (id, label) -> column.addView(text((if (id == selectedSource) "✓  " else "") + label, 15f).apply {
            minimumHeight = dp(52); foreground = ripple(); setTextColor(if (id == selectedSource) accent else foregroundColor)
            setOnClickListener { PlayerMotion.swap(list) { selectedSource = id; render() }; dialog.dismiss() }
        }) }
        dialog.setDismissWithAnimation(PlayerMotion.enabled); dialog.setContentView(android.widget.ScrollView(context).apply { addView(column) }); dialog.show()
    }
    private fun render() {
        val episodes = selectedTab == "episodes"
        PlayerMotion.color(episodesTab, if (episodes) accent else muted); PlayerMotion.color(commentsTab, if (!episodes) accent else muted)
        episodesTab.isSelected = episodes; commentsTab.isSelected = !episodes
        source.visibility = if (episodes) VISIBLE else GONE
        visibleRows = allRows.filter { selectedSource.isEmpty() || it.optString("sourceId") == selectedSource }
        source.text = "播放来源  ·  ${visibleRows.firstOrNull()?.optString("sourceLabel") ?: "暂无来源"}  ﹀"
        summary.text = if (episodes) "全部剧集 · ${visibleRows.size} 集" else "Bangumi 条目评论 · $commentsTotal 条"
        summary.setTextColor(muted); grid.spanCount = if (episodes) 2 else 1
        more.visibility = if (!episodes && commentsLoaded && comments.size < commentsTotal) VISIBLE else GONE
        more.isEnabled = !commentsLoading; more.text = if (commentsLoading) "正在读取…" else "加载更多评论"
        if (episodes && data.has("rows") && visibleRows.isEmpty()) message.text = "暂无可播放剧集，请返回关联本地、WebDAV 或规则来源。"
        message.visibility = if (message.text.isBlank()) GONE else VISIBLE
        adapter.notifyDataSetChanged()
    }

    private inner class RowHolder(val column: LinearLayout) : RecyclerView.ViewHolder(column)
    private inner class RowsAdapter : RecyclerView.Adapter<RowHolder>() {
        override fun getItemCount() = if (selectedTab == "episodes") visibleRows.size else comments.size
        override fun onCreateViewHolder(parent: ViewGroup, type: Int): RowHolder {
            val column = LinearLayout(context).apply { orientation = VERTICAL; setPadding(dp(8), dp(8), dp(8), dp(10)); background = shape(surface, 12); foreground = ripple() }
            column.layoutParams = RecyclerView.LayoutParams(-1, -2).apply { setMargins(dp(3), dp(3), dp(3), dp(9)) }
            return RowHolder(column)
        }
        override fun onBindViewHolder(holder: RowHolder, index: Int) {
            val column = holder.column; column.removeAllViews(); column.setOnClickListener(null)
            if (selectedTab == "comments") {
                val item = comments[index]; column.background = shape(surface, 12)
                column.addView(text(item.optString("userName", "匿名用户"), 14f, true))
                column.addView(text(item.optString("createdAt").take(10) + item.optDouble("rate").takeIf { !it.isNaN() && it > 0 }?.let { " · $it 分" }.orEmpty(), 12f).apply { setTextColor(muted); setPadding(0, dp(5), 0, dp(8)) })
                column.addView(text(item.optString("comment"), 14f).apply { setTextIsSelectable(true) }); return
            }
            val row = visibleRows[index]; val current = row.optBoolean("current")
            column.background = GradientDrawable().apply { setColor(surface); cornerRadius = dp(12).toFloat(); if (current) setStroke(dp(2), accent) }
            val cover = ImageView(context).apply { scaleType = ImageView.ScaleType.FIT_CENTER; setBackgroundColor(Color.rgb(34, 45, 39)); contentDescription = "${row.optString("label")}分集封面" }
            val width = (resources.displayMetrics.widthPixels - dp(60)) / 2
            column.addView(cover, LayoutParams(-1, width * 9 / 16))
            val key = row.optString("episodeKey"); val path = imagePaths[key]
            if (path != null) {
                cover.tag = path
                val cached = bitmaps.get(path)
                if (cached != null) cover.setImageBitmap(cached) else images.execute {
                    val file = File(path)
                    if (!file.canonicalPath.startsWith(File(context.applicationInfo.dataDir).canonicalPath + "/")) return@execute
                    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }; BitmapFactory.decodeFile(path, bounds)
                    val options = BitmapFactory.Options().apply { inSampleSize = 1; while (bounds.outWidth / inSampleSize > width * 2 && inSampleSize < 32) inSampleSize *= 2 }
                    val bitmap = BitmapFactory.decodeFile(path, options)
                    cover.post { if (!disposed && cover.tag == path && cover.isAttachedToWindow && bitmap != null) {
                        bitmaps.put(path, bitmap); cover.setImageBitmap(bitmap)
                        if (shownImages.add(key)) PlayerMotion.enter(cover)
                    } }
                }
            } else {
                cover.setImageResource(android.R.drawable.ic_media_play)
                cover.imageTintList = ColorStateList.valueOf(muted)
                if (key.isNotBlank() && key != "null" && key !in requestedImages && request("image", JSONObject().put("episodeKey", key))) requestedImages.add(key)
            }
            column.addView(text(row.optString("label"), 15f, true).apply { maxLines = 1; ellipsize = TextUtils.TruncateAt.END; setPadding(0, dp(10), 0, dp(5)); if (current) setTextColor(accent) })
            val name = row.optString("title").takeUnless { it == "null" }.orEmpty()
            column.addView(text(if (current) "当前选集${if (name.isBlank()) "" else " · $name"}" else name.ifBlank { "点击播放" }, 12f).apply { setTextColor(muted); maxLines = 2; ellipsize = TextUtils.TruncateAt.END })
            column.isEnabled = row.optBoolean("available") && !playing; column.alpha = if (row.optBoolean("available")) 1f else .45f
            column.contentDescription = "${row.optString("label")}${if (current) " 当前选集" else ""}"
            column.setOnClickListener { if (!current && !playing) { playing = true; request("play", JSONObject().put("target", row.optString("id"))); adapter.notifyDataSetChanged() } }
        }
    }
    fun dispose() { disposed = true; requests.clear(); images.shutdownNow(); bitmaps.evictAll(); list.adapter = null; list.animate().cancel() }
}
