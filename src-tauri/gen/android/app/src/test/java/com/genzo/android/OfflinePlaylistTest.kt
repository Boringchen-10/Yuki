package com.genzo.android

import org.junit.Assert.*
import org.junit.Test

class OfflinePlaylistTest {
    @Test fun rewritesSegmentsKeysAndInitializationMaps() {
        val seen = mutableListOf<String>()
        val original = "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"https://private.example/key?secret=x\"\n#EXT-X-MAP:URI=\"init.mp4\",BYTERANGE=\"512@0\"\n#EXTINF:5,\nsegment.ts?token=secret\n#EXT-X-ENDLIST\n"
        val output = rewriteOfflinePlaylist(original) { value -> seen.add(value); "opaque-${seen.size}" }
        assertEquals(listOf("https://private.example/key?secret=x", "init.mp4", "segment.ts?token=secret"), seen)
        assertTrue(output.contains("URI=\"opaque-1\"")); assertTrue(output.contains("URI=\"opaque-2\",BYTERANGE=\"512@0\""))
        assertTrue(output.contains("\nopaque-3\n")); assertFalse(output.contains("secret"))
    }

    @Test fun preservesByteRangesDurationAndCommentsWithoutInventingResources() {
        val original = "#EXTM3U\n# ordinary comment\n#EXT-X-TARGETDURATION:5\n#EXTINF:5.000,Episode\n#EXT-X-BYTERANGE:128@256\npart.ts\n#EXT-X-ENDLIST\n"
        assertEquals(original.replace("part.ts", "cached-part"), rewriteOfflinePlaylist(original) { "cached-part" })
    }

    @Test fun handlesTheSelectedVideoAndAudioMasterReferences() {
        val original = "#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"main\",NAME=\"Default\",URI=\"audio.m3u8\"\n#EXT-X-STREAM-INF:BANDWIDTH=2000000,AUDIO=\"main\"\nvideo.m3u8\n"
        val output = rewriteOfflinePlaylist(original) { "http://127.0.0.1/token/$it" }
        assertTrue(output.contains("URI=\"http://127.0.0.1/token/audio.m3u8\""))
        assertTrue(output.contains("\nhttp://127.0.0.1/token/video.m3u8\n"))
        assertTrue(output.contains("GROUP-ID=\"main\",NAME=\"Default\""))
    }
}
