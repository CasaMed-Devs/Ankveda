package expo.modules.invoicedownloads

import android.content.ContentValues
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

private class SaveFailedException(message: String) : CodedException("ERR_SAVE_TO_DOWNLOADS", message, null)

/**
 * Copies a file from the app's cache into the device's public Downloads folder through MediaStore
 * (Android 10+), so it shows up in Files / Downloads without a folder picker or storage permission.
 */
class InvoiceDownloadsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("InvoiceDownloads")

    // MediaStore.Downloads exists from Android 10 (API 29). Older versions use the folder picker in JS.
    Constant("isSupported") { Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q }

    AsyncFunction("saveToDownloads") { sourceUri: String, fileName: String, mimeType: String ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) throw SaveFailedException("Saving to Downloads needs Android 10 or newer.")
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      val source = File(Uri.parse(sourceUri).path ?: throw SaveFailedException("Invalid file: $sourceUri"))
      if (!source.exists()) throw SaveFailedException("The invoice file was not found.")

      val resolver = context.contentResolver
      val pending = ContentValues().apply {
        put(MediaStore.Downloads.DISPLAY_NAME, fileName) // Android adds " (1)" if the name is taken
        put(MediaStore.Downloads.MIME_TYPE, mimeType)
        put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
        put(MediaStore.Downloads.IS_PENDING, 1)
      }
      val target = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, pending)
        ?: throw SaveFailedException("Could not create the file in Downloads.")
      try {
        val output = resolver.openOutputStream(target) ?: throw SaveFailedException("Could not write to Downloads.")
        output.use { out -> source.inputStream().use { it.copyTo(out) } }
        resolver.update(target, ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }, null, null)
      } catch (e: Exception) {
        resolver.delete(target, null, null)
        throw e
      }
      target.toString()
    }
  }
}
