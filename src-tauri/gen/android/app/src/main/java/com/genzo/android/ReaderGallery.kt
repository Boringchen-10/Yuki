package com.genzo.android

import android.Manifest
import android.content.ContentValues
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaScannerConnection
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import androidx.core.content.ContextCompat
import java.io.File
import java.io.IOException

/**
 * Copies a reader image into the system gallery.
 *
 * The reader caches every page as a hash-named file without an extension, so the
 * container format is sniffed from the bytes instead of the file name. Formats the
 * reader renders natively are copied byte for byte; anything else is decoded once
 * and written as JPEG so the gallery can still show it.
 *
 * Writing is blocking. Call [save] from Dispatchers.IO.
 */
internal object ReaderGallery {
    const val ALBUM = "Yuki"

    /** Result code for the legacy storage permission request owned by ReaderActivity. */
    const val PERMISSION_REQUEST = 5411

    private const val MAX_REENCODED_EDGE = 4096

    /** Android 9 and older need WRITE_EXTERNAL_STORAGE before MediaStore accepts a new image. */
    fun needsStoragePermission(context: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.Q &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED

    fun save(context: Context, source: File, baseName: String): Boolean = try {
        val (file, format) = prepared(context, source) ?: return false
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) saveScoped(context, file, baseName, format)
            else saveLegacy(context, file, baseName, format)
        } finally {
            if (file !== source) file.delete()
        }
    } catch (_: Exception) {
        false
    }

    /**
     * Returns the file to copy plus its container format. Unknown containers are
     * decoded and re-encoded to a temporary JPEG; null means the bytes were not
     * a readable image at all.
     */
    private fun prepared(context: Context, source: File): Pair<File, ReaderImageFormat>? {
        ReaderImageFormat.of(source)?.let { return source to it }
        val bitmap = decodeBounded(source) ?: return null
        val temp = try {
            File.createTempFile("yuki-gallery-", ".jpg", context.cacheDir).also { file ->
                val encoded = file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, 92, it) }
                if (!encoded || file.length() == 0L) throw IOException("image re-encode failed")
            }
        } finally {
            bitmap.recycle()
        }
        return temp to ReaderImageFormat.JPEG
    }

    private fun decodeBounded(source: File): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(source.path, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
        var sample = 1
        while (bounds.outWidth / sample > MAX_REENCODED_EDGE || bounds.outHeight / sample > MAX_REENCODED_EDGE) sample *= 2
        return BitmapFactory.decodeFile(source.path, BitmapFactory.Options().apply { inSampleSize = sample })
    }

    private fun saveScoped(context: Context, source: File, baseName: String, format: ReaderImageFormat): Boolean {
        val resolver = context.contentResolver
        val values = ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, "${readerImageFileName(baseName)}.${format.extension}")
            put(MediaStore.Images.Media.MIME_TYPE, format.mime)
            put(MediaStore.Images.Media.RELATIVE_PATH, "${Environment.DIRECTORY_PICTURES}/$ALBUM")
            put(MediaStore.Images.Media.IS_PENDING, 1)
        }
        val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values) ?: return false
        return try {
            resolver.openOutputStream(uri)?.use { output -> source.inputStream().use { it.copyTo(output) } }
                ?: throw IOException("gallery stream unavailable")
            resolver.update(uri, ContentValues().apply { put(MediaStore.Images.Media.IS_PENDING, 0) }, null, null)
            true
        } catch (_: Exception) {
            resolver.delete(uri, null, null)
            false
        }
    }

    @Suppress("DEPRECATION")
    private fun saveLegacy(context: Context, source: File, baseName: String, format: ReaderImageFormat): Boolean {
        val album = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), ALBUM)
        if (!album.isDirectory && !album.mkdirs()) return false
        val target = uniqueTarget(album, readerImageFileName(baseName), format.extension)
        source.inputStream().use { input -> target.outputStream().use { output -> input.copyTo(output) } }
        MediaScannerConnection.scanFile(context, arrayOf(target.absolutePath), arrayOf(format.mime), null)
        return true
    }

    internal fun uniqueTarget(album: File, name: String, extension: String): File {
        var candidate = File(album, "$name.$extension")
        var index = 2
        while (!candidate.createNewFile()) {
            candidate = File(album, "$name ($index).$extension")
            index++
        }
        return candidate
    }
}

/** Container formats the gallery accepts directly, identified from the first bytes. */
internal data class ReaderImageFormat(val mime: String, val extension: String) {
    companion object {
        val JPEG = ReaderImageFormat("image/jpeg", "jpg")
        val PNG = ReaderImageFormat("image/png", "png")
        val WEBP = ReaderImageFormat("image/webp", "webp")
        val GIF = ReaderImageFormat("image/gif", "gif")

        /** Null when the header is not one of the formats copied as-is. */
        fun detect(header: ByteArray, length: Int = header.size): ReaderImageFormat? {
            fun at(index: Int) = if (index in 0 until length && index < header.size) header[index].toInt() and 0xFF else -1
            fun ascii(start: Int, text: String) = text.indices.all { at(start + it) == text[it].code }
            if (length >= 3 && at(0) == 0xFF && at(1) == 0xD8 && at(2) == 0xFF) return JPEG
            if (length >= 8 && at(0) == 0x89 && ascii(1, "PNG") && at(4) == 0x0D && at(5) == 0x0A) return PNG
            if (length >= 6 && (ascii(0, "GIF87a") || ascii(0, "GIF89a"))) return GIF
            if (length >= 12 && ascii(0, "RIFF") && ascii(8, "WEBP")) return WEBP
            return null
        }

        fun of(file: File): ReaderImageFormat? = try {
            val header = ByteArray(12)
            val read = file.inputStream().use { it.read(header) }
            detect(header, read)
        } catch (_: Exception) {
            null
        }
    }
}

/**
 * Gallery-safe display name without extension: drops path and wildcard characters
 * that break MediaStore or a FAT volume, collapses whitespace and caps the length.
 */
internal fun readerImageFileName(raw: String): String {
    val cleaned = raw
        .replace(Regex("[\\\\/:*?\"<>|]"), " ")
        .replace(Regex("\\p{Cntrl}"), " ")
        .replace(Regex("\\s+"), " ")
        .trim()
        .trim('.')
        .take(64)
        .trim()
        .trim('.')
    return cleaned.ifBlank { "Yuki 图片" }
}
