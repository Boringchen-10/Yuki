package com.genzo.android

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class DownloadStorageTest {
    @Test fun onlyAppOwnedMountedLocationsCanBeSelectedAndSelectionPersists() {
        val context=ApplicationProvider.getApplicationContext<Context>()
        check(context.packageName.endsWith("qa"))
        val previous=DownloadStorage.selectedId(context)
        try {
            for (location in DownloadStorage.locations(context)) {
                assertEquals(location.id,DownloadStorage.select(context,location.id).getString("selected"))
                assertEquals(location.id,DownloadStorage.selectedId(context))
                assertEquals(location.root.canonicalFile,DownloadStorage.root(context,location.id).canonicalFile)
            }
            val selected=DownloadStorage.selectedId(context)
            try { DownloadStorage.select(context,"../../outside"); fail("must reject") } catch (_:Exception) { }
            assertEquals(selected,DownloadStorage.selectedId(context))
        } finally { DownloadStorage.select(context,previous) }
    }
    @Test fun readerArchiveCannotEscapeKnownDownloadLocations() {
        val context=ApplicationProvider.getApplicationContext<Context>(); check(context.packageName.endsWith("qa"))
        for (location in DownloadStorage.locations(context)) {
            val file=File(location.root,"reading-cache/v1/fixture/chapter.cbz")
            assertEquals(file.canonicalFile,DownloadStorage.readingArchive(context,file.path))
        }
        for (file in listOf(File(context.dataDir,"genzo.db"),File(context.cacheDir,"arbitrary.epub"),File("/sdcard/other.cbz"))) {
            try { DownloadStorage.readingArchive(context,file.path); fail("must reject") } catch (_:IllegalArgumentException) { }
        }
    }
}
