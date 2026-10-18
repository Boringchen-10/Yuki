package com.genzo.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ReaderGalleryTest {
    private fun header(vararg bytes: Int) = ByteArray(bytes.size) { bytes[it].toByte() }

    @Test fun containerFormatsAreSniffedFromTheFirstBytes() {
        assertEquals(ReaderImageFormat.JPEG, ReaderImageFormat.detect(header(0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10, 0x4A, 0x46)))
        assertEquals(ReaderImageFormat.PNG, ReaderImageFormat.detect(header(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)))
        assertEquals(ReaderImageFormat.GIF, ReaderImageFormat.detect(header('G'.code, 'I'.code, 'F'.code, '8'.code, '9'.code, 'a'.code)))
        assertEquals(ReaderImageFormat.WEBP, ReaderImageFormat.detect(header('R'.code, 'I'.code, 'F'.code, 'F'.code, 0x10, 0, 0, 0, 'W'.code, 'E'.code, 'B'.code, 'P'.code)))
        assertNull(ReaderImageFormat.detect(header(0x42, 0x4D, 0x36, 0, 0, 0, 0, 0)))
        assertNull(ReaderImageFormat.detect(ByteArray(0)))
    }

    @Test fun truncatedHeadersAreNotMistakenForImages() {
        assertNull(ReaderImageFormat.detect(header(0xFF, 0xD8)))
        assertNull(ReaderImageFormat.detect(header(0x89, 0x50)))
        assertNull(ReaderImageFormat.detect(header('R'.code, 'I'.code, 'F'.code, 'F'.code, 0, 0, 0, 0, 'W'.code, 'E'.code)))
    }

    @Test fun galleryNamesDropPathWildcardAndControlCharacters() {
        assertEquals("Yuki 第1话 第3页", readerImageFileName("Yuki 第1话 第3页"))
        assertEquals("Yuki 第1话 第3页", readerImageFileName("Yuki/第1话\\第3页"))
        assertEquals("a b", readerImageFileName("a:*?\"<>|b"))
        assertEquals("a b", readerImageFileName("a\n\tb"))
        assertEquals("名字", readerImageFileName("....名字...."))
        assertEquals("a b", readerImageFileName("  a   b  "))
    }

    @Test fun galleryNamesKeepALimitAndFallBackWhenEmpty() {
        val long = readerImageFileName("页".repeat(200))
        assertEquals(64, long.length)
        assertEquals("Yuki 图片", readerImageFileName("   "))
        assertEquals("Yuki 图片", readerImageFileName("///"))
    }
}
