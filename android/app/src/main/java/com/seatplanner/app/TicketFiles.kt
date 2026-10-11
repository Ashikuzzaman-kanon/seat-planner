package com.seatplanner.app

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.util.Base64
import android.widget.Toast
import androidx.core.content.FileProvider
import java.io.File
import java.io.IOException

/**
 * The tickets PDF, opened in the phone's PDF viewer.
 *
 * In a browser the site opens the PDF in a new tab. A WebView has no tabs, so
 * inside the app the page hands the file over instead (see openTicketPdf in
 * frontend/src/lib/booking.js) and it is shown from here. With no PDF viewer
 * installed, the share sheet offers somewhere to save or send it.
 */
object TicketFiles {

    private const val DIR = "tickets"

    fun open(activity: Activity, name: String, base64: String) {
        val file = try {
            save(activity, name, Base64.decode(base64, Base64.DEFAULT))
        } catch (e: IllegalArgumentException) {
            null
        } catch (e: IOException) {
            null
        }
        if (file == null) {
            Toast.makeText(activity, R.string.pdf_failed, Toast.LENGTH_LONG).show()
            return
        }

        val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.files", file)
        val view = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/pdf")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        try {
            activity.startActivity(view)
        } catch (e: ActivityNotFoundException) {
            val share = Intent(Intent.ACTION_SEND)
                .setType("application/pdf")
                .putExtra(Intent.EXTRA_STREAM, uri)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            activity.startActivity(Intent.createChooser(share, activity.getString(R.string.pdf_share)))
        }
    }

    /** Only the latest file is kept: the viewer has it open, and the site can always make it again. */
    private fun save(activity: Activity, name: String, bytes: ByteArray): File {
        val dir = File(activity.cacheDir, DIR)
        dir.listFiles()?.forEach { it.delete() }
        if (!dir.isDirectory && !dir.mkdirs()) throw IOException("Cannot create $dir")
        return File(dir, safeName(name)).apply { writeBytes(bytes) }
    }

    /** A file name the page cannot use to step outside the folder. */
    fun safeName(name: String): String {
        val base = name.substringAfterLast('/').substringAfterLast('\\')
            .replace(Regex("[^A-Za-z0-9._-]"), "_")
            .trimStart('.')
            .take(80)
            .ifBlank { "tickets" }
        return if (base.endsWith(".pdf", ignoreCase = true)) base else "$base.pdf"
    }
}
