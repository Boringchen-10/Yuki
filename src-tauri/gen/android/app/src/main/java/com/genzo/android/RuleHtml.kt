package com.genzo.android

import org.jsoup.Jsoup
import org.jsoup.helper.W3CDom
import org.json.JSONArray
import org.json.JSONObject
import org.w3c.dom.Node
import org.w3c.dom.NodeList
import javax.xml.xpath.XPathConstants
import javax.xml.xpath.XPathFactory

/** Kazumi XPath contexts: // in a result/road is relative to that node. */
object RuleHtml {
    fun parse(html: String, rule: JSONObject, operation: String): JSONObject {
        require(html.toByteArray().size <= 2 * 1024 * 1024)
        val document = W3CDom().namespaceAware(false).fromJsoup(Jsoup.parse(html))
        val xpath = XPathFactory.newInstance().newXPath()
        var budget = 0
        fun account(name: String, url: String) { budget += name.toByteArray().size + url.toByteArray().size; require(budget <= 2 * 1024 * 1024) { "规则结果过大，请缩小选择器" } }
        fun nodes(field: String, context: Node, relative: Boolean = false): List<Node> {
            val expression = rule.optString(field)
            require(expression.isNotBlank() && expression.length <= 2048) { "规则 $field 选择器为空或过长" }
            val path = if (relative && expression.startsWith("//")) ".$expression" else expression
            val result = try { xpath.evaluate(path, context, XPathConstants.NODESET) as NodeList }
                catch (_: Exception) { throw IllegalArgumentException("规则 $field XPath 无效") }
            require(result.length <= 10000) { "规则结果过多" }
            return (0 until result.length).map { result.item(it) }
        }
        val anti = rule.optJSONObject("antiCrawlerConfig")
        if (anti?.optBoolean("enabled") == true) {
            val explicit = anti.optString("captchaDetectValue")
            fun hasNode(expression: String) = expression.isNotBlank() && try { (xpath.evaluate(expression, document, XPathConstants.NODESET) as NodeList).length > 0 } catch (_: Exception) { false }
            val challenge = if (explicit.isBlank()) listOf("captchaImage", "captchaButton", "captchaInput").any { hasNode(anti.optString(it)) } else when (anti.optInt("captchaDetectType", 1)) {
                1 -> hasNode(explicit)
                2 -> html.contains(explicit)
                // Regex detection is performed by Rust's bounded, linear-time engine.
                else -> false
            }
            if (challenge) return JSONObject().put("verificationRequired", true)
        }
        if (operation == "search") {
            val items = JSONArray()
            nodes("searchList", document).take(200).forEach { node ->
                val name = nodes("searchName", node, true).firstOrNull()?.textContent?.trim().orEmpty().take(300)
                val source = nodes("searchResult", node, true).firstOrNull()?.attributes?.getNamedItem("href")?.nodeValue?.trim().orEmpty()
                if (name.isNotBlank() && source.isNotBlank() && source.length <= 16384) { account(name, source); items.put(JSONObject().put("name", name).put("source", source)) }
            }
            return JSONObject().put("items", items)
        }
        val roads = JSONArray()
        var total = 0
        nodes("chapterRoads", document).take(100).forEach { node ->
            val episodes = JSONArray()
            nodes("chapterResult", node, true).forEachIndexed { index, episode ->
                val source = episode.attributes?.getNamedItem("href")?.nodeValue?.trim().orEmpty()
                if (source.isNotBlank() && source.length <= 16384) { val name = episode.textContent.replace(Regex("\\s+"), "").take(200).ifBlank { "第${index + 1}集" }; account(name, source); require(++total <= 10000) { "规则剧集过多" }; episodes.put(JSONObject().put("name", name).put("url", source)) }
            }
            if (episodes.length() > 0) roads.put(JSONObject().put("name", "线路${roads.length() + 1}").put("episodes", episodes))
        }
        return JSONObject().put("roads", roads)
    }
}
