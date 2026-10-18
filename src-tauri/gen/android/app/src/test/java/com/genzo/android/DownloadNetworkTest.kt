package com.genzo.android

import org.junit.Assert.*
import org.junit.Test

class DownloadNetworkTest {
    @Test fun optInPolicyBlocksCellularAndDisconnectedNetworks() {
        assertTrue(downloadNetworkAllowed(false, false, true))
        assertFalse(downloadNetworkAllowed(true, false, true))
        assertFalse(downloadNetworkAllowed(true, false, false))
        assertTrue(downloadNetworkAllowed(true, true, false))
    }
    @Test fun aVpnWithCellularTransportDoesNotBypassWifiOnly() {
        assertFalse(downloadNetworkAllowed(true, true, true))
    }
}
