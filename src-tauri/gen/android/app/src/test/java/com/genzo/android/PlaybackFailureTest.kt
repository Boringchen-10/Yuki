package com.genzo.android

import org.junit.Assert.*
import org.junit.Test

class PlaybackFailureTest {
    @Test fun oldRendererMigratesWithoutChangingSupportedChoices() {
        assertEquals("auto", PlaybackSettings.migrateRenderer("compat"))
        assertEquals("auto", PlaybackSettings.migrateRenderer(null))
        for (choice in PlaybackSettings.renderers.keys) assertEquals(choice, PlaybackSettings.migrateRenderer(choice))
        assertFalse(PlaybackSettings.renderers.containsKey("compat"))
    }
    @Test fun renderingRecoveryIsFiniteAndKeepsUserPreferenceOutsideThePlan() {
        val first = nextPlaybackRecovery("render_failed", "gpu-next", 2, true, emptySet())!!
        assertEquals("gpu-next", first.renderer); assertEquals(0, first.mode)
        val next = nextPlaybackRecovery("render_failed", first.renderer, first.mode, true, setOf("no-shaders"))!!
        assertEquals("gpu", next.renderer)
        assertNull(nextPlaybackRecovery("render_failed", next.renderer, next.mode, true, setOf("no-shaders", "opengl")))
    }
    @Test fun decodingRecoveryUsesSoftwareAndLeavesDirectSurface() {
        val next = nextPlaybackRecovery("decode_failed", "mediacodec_embed", 0, true, emptySet())!!
        assertEquals("gpu", next.renderer); assertTrue(next.software)
        assertNull(nextPlaybackRecovery("decode_failed", "gpu", 0, false, setOf("software")))
    }
    @Test fun networkAndFormatFailuresDoNotRebuildRenderers() {
        for (code in listOf("source_offline", "network_timeout", "credential_invalid", "unsupported_media", "file_unavailable", "resolve_failed")) {
            assertNull(nextPlaybackRecovery(code, "gpu-next", 2, true, emptySet()))
            assertEquals(code, PlaybackFailure.from(code).code)
        }
    }
    @Test fun sourceFailuresGiveSpecificActions() {
        assertFalse(PlaybackFailure.from("credential_invalid").retryable)
        assertTrue(PlaybackFailure.from("credential_invalid").message.contains("重新获取"))
        assertTrue(PlaybackFailure.from("network_timeout").retryable)
        assertTrue(PlaybackFailure.from("permission_denied").message.contains("授权"))
        assertTrue(PlaybackFailure.from("decode_failed").message.contains("硬件解码"))
    }
}
