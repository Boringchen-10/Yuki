package com.genzo.android

// Keep the selected preset; a session may use less processing when it cannot keep up.
class Anime4kBudget {
    var limit = 2; private set
    var reason: String? = null; private set
    private var sampledAt = 0L
    private var previousDrops = 0L
    private var overloaded = 0
    fun reset(requested: Int = 2) { limit = requested; reason = null; sampledAt = 0; overloaded = 0 }
    fun mode(requested: Int, width: Int, height: Int, outputWidth: Int, outputHeight: Int): Int {
        // A 1440p/4K source already larger than the phone output needs downscaling.
        // Running restoration CNNs at source resolution spends GPU time with no upscale.
        return if (minOf(width, height) > 1080 && outputWidth > 0 && outputHeight > 0 && width >= outputWidth && height >= outputHeight) 0 else minOf(requested, limit)
    }
    fun sample(now: Long, drops: Long, gpuMs: Double, fps: Double, speed: Double): Boolean {
        if (sampledAt == 0L || drops < previousDrops) {
            sampledAt = now; previousDrops = drops; overloaded = 0; return false
        }
        val elapsed = now - sampledAt
        if (elapsed < 2000) return false
        val frames = elapsed / 1000.0 * fps * speed
        val pressure = frames > 0 && ((drops - previousDrops) / frames > 0.05 || gpuMs > 800.0 / (fps * speed))
        sampledAt = now; previousDrops = drops
        overloaded = if (pressure) overloaded + 1 else 0
        if (overloaded < 3 || limit == 0) return false
        limit--; overloaded = 0
        reason = if (limit == 1) "超分处理负载较高，本次已改用流畅档" else "超分处理负载较高，本次已暂停超分"
        return true
    }
}
