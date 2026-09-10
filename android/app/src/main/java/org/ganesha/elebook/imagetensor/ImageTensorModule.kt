package org.ganesha.elebook.imagetensor

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.net.Uri
import androidx.exifinterface.media.ExifInterface
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.WritableNativeArray
import java.io.File
import java.io.FileOutputStream

class ImageTensorModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "ImageTensorModule"

        /**
         * Resize toward (targetWidth, targetHeight) via repeated 2x downscales
         * before the final step, instead of one large single-shot bilinear
         * resize.
         *
         * `Bitmap.createScaledBitmap`'s bilinear filter is only accurate for
         * moderate size reductions. For a large reduction in one step (e.g. a
         * multi-megapixel photo down to 440x440 — 10x or more per axis), it
         * aliases: high-frequency detail gets folded into different values
         * instead of being averaged away, unlike PIL/torchvision's `Resize`
         * (used by the Python reference pipeline), which applies antialiasing
         * before subsampling. Repeated halving approximates that antialiasing
         * with a box/mipmap-style filter chain, so each individual step never
         * exceeds a 2x reduction. Verified against Project Ganesha's golden
         * on-device parity test (E13-4).
         */
        private fun progressiveResize(source: Bitmap, targetWidth: Int, targetHeight: Int): Bitmap {
            if (source.width == targetWidth && source.height == targetHeight) {
                return source
            }

            var current = source
            while (current.width > targetWidth * 2 && current.height > targetHeight * 2) {
                val nextWidth = maxOf(targetWidth, current.width / 2)
                val nextHeight = maxOf(targetHeight, current.height / 2)
                val next = Bitmap.createScaledBitmap(current, nextWidth, nextHeight, true)
                if (current !== source) {
                    current.recycle()
                }
                current = next
            }

            val result = Bitmap.createScaledBitmap(current, targetWidth, targetHeight, true)
            if (current !== source) {
                current.recycle()
            }
            return result
        }

        /**
         * Convert a bitmap to a normalized NCHW Float32 tensor.
         * Exposed for unit testing.
         */
        fun bitmapToNchw(
            bitmap: Bitmap,
            targetWidth: Int,
            targetHeight: Int,
            mean: DoubleArray,
            std: DoubleArray,
            scale: Double,
            bgr: Boolean,
        ): DoubleArray {
            val resized = progressiveResize(bitmap, targetWidth, targetHeight)

            val w = resized.width
            val h = resized.height
            val pixels = IntArray(w * h)
            resized.getPixels(pixels, 0, w, 0, 0, w, h)

            if (resized !== bitmap) resized.recycle()

            val output = DoubleArray(3 * h * w)

            // Channel indices: RGB by default, swap 0↔2 for BGR
            val rIdx = if (bgr) 2 else 0
            val gIdx = 1
            val bIdx = if (bgr) 0 else 2

            for (i in pixels.indices) {
                val pixel = pixels[i]
                // Android ARGB packing: (A << 24) | (R << 16) | (G << 8) | B
                val r = (pixel shr 16 and 0xFF).toDouble()
                val g = (pixel shr 8 and 0xFF).toDouble()
                val b = (pixel and 0xFF).toDouble()

                // NCHW layout: channel * H * W + row * W + col
                // `scale` is a multiplier per docs/EMBEDDING_PACK_FORMAT.md (e.g. 1/255 to move
                // uint8 [0,255] into float [0,1] before mean/std normalization).
                output[rIdx * h * w + i] = (r * scale - mean[0]) / std[0]
                output[gIdx * h * w + i] = (g * scale - mean[1]) / std[1]
                output[bIdx * h * w + i] = (b * scale - mean[2]) / std[2]
            }

            return output
        }

        /**
         * Re-orient a decoded bitmap into the upright grid that EXIF-aware
         * viewers display.
         *
         * `BitmapFactory` returns the stored sensor pixels and ignores the EXIF
         * orientation tag, while React Native's <Image> (Fresco, autoRotate) and
         * every photo viewer apply it. Without this step the detector normalizes
         * boxes against one grid and the UI draws them on another, so boxes are
         * transposed on screen and crops -- the pixels MiewID actually embeds --
         * are cut from the wrong region. Applying the tag once, here, keeps the
         * detector, the overlay, and the crop on a single coordinate frame.
         *
         * Returns the input untouched when no transform is needed; otherwise a
         * new bitmap. Callers own recycling the input.
         *
         * Exposed for unit testing.
         */
        fun applyExifOrientation(bitmap: Bitmap, orientation: Int): Bitmap {
            val matrix = Matrix()
            when (orientation) {
                ExifInterface.ORIENTATION_ROTATE_90 -> matrix.postRotate(90f)
                ExifInterface.ORIENTATION_ROTATE_180 -> matrix.postRotate(180f)
                ExifInterface.ORIENTATION_ROTATE_270 -> matrix.postRotate(270f)
                ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.postScale(-1f, 1f)
                ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.postScale(1f, -1f)
                ExifInterface.ORIENTATION_TRANSPOSE -> {
                    matrix.postRotate(90f)
                    matrix.postScale(-1f, 1f)
                }
                ExifInterface.ORIENTATION_TRANSVERSE -> {
                    matrix.postRotate(270f)
                    matrix.postScale(-1f, 1f)
                }
                // ORIENTATION_NORMAL, ORIENTATION_UNDEFINED, anything unknown.
                else -> return bitmap
            }
            return Bitmap.createBitmap(
                bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true,
            )
        }

        /**
         * Crop a bitmap to pixel coordinates and save as JPEG.
         * Exposed for unit testing.
         */
        fun cropAndSave(
            bitmap: Bitmap,
            normX: Double,
            normY: Double,
            normW: Double,
            normH: Double,
            outputPath: String,
            quality: Int = 95,
        ) {
            val imgW = bitmap.width
            val imgH = bitmap.height

            val px = (normX * imgW).toInt().coerceIn(0, imgW - 1)
            val py = (normY * imgH).toInt().coerceIn(0, imgH - 1)
            val pw = (normW * imgW).toInt().coerceIn(1, imgW - px)
            val ph = (normH * imgH).toInt().coerceIn(1, imgH - py)

            val cropped = Bitmap.createBitmap(bitmap, px, py, pw, ph)
            val outFile = File(outputPath)
            outFile.parentFile?.mkdirs()

            FileOutputStream(outFile).use { fos ->
                cropped.compress(Bitmap.CompressFormat.JPEG, quality, fos)
            }
            if (cropped !== bitmap) cropped.recycle()
        }
    }

    override fun getName(): String = NAME

    @ReactMethod
    fun imageToTensor(
        uri: String,
        width: Double,
        height: Double,
        mean: ReadableArray,
        std: ReadableArray,
        scale: Double,
        channelOrder: String,
        promise: Promise,
    ) {
        Thread {
            try {
                val bitmap = loadBitmap(uri)
                    ?: return@Thread promise.reject("IMAGE_ERROR", "Could not load image: $uri")

                val meanArr = doubleArrayOf(
                    mean.getDouble(0), mean.getDouble(1), mean.getDouble(2),
                )
                val stdArr = doubleArrayOf(
                    std.getDouble(0), std.getDouble(1), std.getDouble(2),
                )

                val output = bitmapToNchw(
                    bitmap,
                    width.toInt(),
                    height.toInt(),
                    meanArr,
                    stdArr,
                    scale,
                    bgr = channelOrder.equals("BGR", ignoreCase = true),
                )
                bitmap.recycle()

                val result = WritableNativeArray()
                for (v in output) {
                    result.pushDouble(v)
                }
                promise.resolve(result)
            } catch (e: Exception) {
                promise.reject("IMAGE_ERROR", "Failed to convert image to tensor: ${e.message}", e)
            }
        }.start()
    }

    @ReactMethod
    fun cropImage(
        uri: String,
        x: Double,
        y: Double,
        width: Double,
        height: Double,
        outputPath: String,
        promise: Promise,
    ) {
        Thread {
            try {
                val bitmap = loadBitmap(uri)
                    ?: return@Thread promise.reject("IMAGE_ERROR", "Could not load image: $uri")

                cropAndSave(bitmap, x, y, width, height, outputPath)
                bitmap.recycle()

                promise.resolve(outputPath)
            } catch (e: Exception) {
                promise.reject("IMAGE_ERROR", "Failed to crop image: ${e.message}", e)
            }
        }.start()
    }

    /**
     * Decode an image and return it on the upright display grid.
     *
     * Every consumer in this module -- the detector tensor and the saved crop --
     * goes through here, so they cannot disagree about orientation.
     */
    private fun loadBitmap(uri: String): Bitmap? {
        val decoded = decodeBitmap(uri) ?: return null
        val upright = applyExifOrientation(decoded, readExifOrientation(uri))
        if (upright !== decoded) {
            decoded.recycle()
        }
        return upright
    }

    private fun decodeBitmap(uri: String): Bitmap? {
        return try {
            val parsed = Uri.parse(uri)
            when (parsed.scheme) {
                "content" -> {
                    reactApplicationContext.contentResolver.openInputStream(parsed)?.use { stream ->
                        BitmapFactory.decodeStream(stream)
                    }
                }
                "file" -> BitmapFactory.decodeFile(parsed.path)
                else -> {
                    // Try as a plain file path
                    val file = File(uri)
                    if (file.exists()) BitmapFactory.decodeFile(uri) else null
                }
            }
        } catch (_: Exception) {
            null
        }
    }

    /**
     * Read the EXIF orientation tag, defaulting to NORMAL when the image has no
     * tag or cannot be parsed. An unreadable tag must not fail the capture.
     */
    private fun readExifOrientation(uri: String): Int {
        return try {
            val parsed = Uri.parse(uri)
            val exif = when (parsed.scheme) {
                "content" -> {
                    reactApplicationContext.contentResolver.openInputStream(parsed)?.use { stream ->
                        ExifInterface(stream)
                    }
                }
                "file" -> parsed.path?.let { ExifInterface(it) }
                else -> if (File(uri).exists()) ExifInterface(uri) else null
            }
            exif?.getAttributeInt(
                ExifInterface.TAG_ORIENTATION,
                ExifInterface.ORIENTATION_NORMAL,
            ) ?: ExifInterface.ORIENTATION_NORMAL
        } catch (_: Exception) {
            ExifInterface.ORIENTATION_NORMAL
        }
    }
}
