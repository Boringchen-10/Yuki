package com.genzo.android

import org.junit.Assert.*
import org.junit.Test

class Anime4kBudgetTest {
    @Test fun downscaledHighResolutionDoesNotRunSourceSizeCnns() {
        val budget = Anime4kBudget()
        assertEquals(0, budget.mode(2, 3840, 2160, 2261, 1272))
        assertEquals(0, budget.mode(1, 2560, 1440, 1272, 715))
        assertEquals(2, budget.mode(2, 1920, 1080, 2261, 1272))
        assertEquals(2, budget.mode(2, 1280, 720, 2261, 1272))
        assertEquals(2, budget.mode(2, 3840, 2160, 7680, 4320))
    }
    @Test fun isolatedSpikesDoNotDowngradeButSustainedLoadDoes() {
        val budget = Anime4kBudget()
        assertFalse(budget.sample(1000, 0, 70.0, 24.0, 1.0))
        assertFalse(budget.sample(3000, 0, 70.0, 24.0, 1.0))
        assertFalse(budget.sample(5000, 0, 10.0, 24.0, 1.0))
        assertFalse(budget.sample(7000, 0, 70.0, 24.0, 1.0))
        assertFalse(budget.sample(9000, 0, 70.0, 24.0, 1.0))
        assertTrue(budget.sample(11000, 0, 70.0, 24.0, 1.0))
        assertEquals(1, budget.limit)
        budget.reset(); assertEquals(2, budget.limit); assertNull(budget.reason)
    }
    @Test fun droppedFramesAndPlaybackSpeedRespectFrameBudget() {
        val budget = Anime4kBudget()
        for (i in 0..2) assertFalse(budget.sample(1000L + i * 2000, i * 12L, 1.0, 24.0, 1.0))
        assertTrue(budget.sample(7000, 36, 1.0, 24.0, 1.0))
        budget.reset()
        for (i in 0..2) assertFalse(budget.sample(1000L + i * 2000, 0, 24.0, 24.0, 2.0))
        assertTrue(budget.sample(7000, 0, 24.0, 24.0, 2.0))
    }
    @Test fun efficiencyDropsDirectlyToOffWhenItCannotKeepUp() {
        val budget = Anime4kBudget(); budget.reset(1)
        for (i in 0..2) assertFalse(budget.sample(1000L + i * 2000, 0, 50.0, 24.0, 1.0))
        assertTrue(budget.sample(7000, 0, 50.0, 24.0, 1.0))
        assertEquals(0, budget.limit)
    }
    @Test fun pausedAndResetCountersDoNotTriggerAFalseDowngrade() {
        val budget = Anime4kBudget()
        for (i in 0..5) assertFalse(budget.sample(1000L + i * 2000, 0, 100.0, 0.0, 1.0))
        assertEquals(2, budget.limit)
        budget.sample(14000, 99, 100.0, 24.0, 1.0)
        assertFalse(budget.sample(16000, 0, 100.0, 24.0, 1.0))
        assertEquals(2, budget.limit)
    }
}
