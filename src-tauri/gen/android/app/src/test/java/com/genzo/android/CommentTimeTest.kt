package com.genzo.android

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Instant

class CommentTimeTest {
    @Test fun relativeTimesKeepTheSourceInstantAndDoNotShowNegativeFutureAges() {
        val now = Instant.parse("2026-10-13T08:00:00Z").toEpochMilli()
        assertEquals("5分钟前", CommentTime.format("2026-10-13T07:55:00Z", now))
        assertEquals("5分钟前", CommentTime.format("2026-10-13T15:55:00+08:00", now))
        assertEquals("2小时前", CommentTime.format("2026-10-13T06:00:00Z", now))
        assertEquals("3天前", CommentTime.format("2026-10-10T08:00:00Z", now))
        assertEquals("刚刚", CommentTime.format("2026-10-13T09:00:00Z", now))
        assertEquals("unknown", CommentTime.format("unknown", now))
    }
    @Test fun commentImagesBoundBothDimensionsAndDecodedPixels() {
        val tall = CommentImageSampling.sample(480,12000,1080,6000)
        org.junit.Assert.assertTrue(480L * 12000 / tall / tall <= 1_048_576)
        org.junit.Assert.assertTrue(12000 / tall <= 6000)
        val avatar = CommentImageSampling.sample(12000,12000,192,192,65_536)
        org.junit.Assert.assertTrue(12000 / avatar <= 192)
        assertEquals(1,CommentImageSampling.sample(48,48,96,96))
    }
}
