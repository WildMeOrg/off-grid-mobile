package org.ganesha.elebook.embedding

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.WritableNativeArray
import com.facebook.react.bridge.WritableNativeMap
import org.ganesha.elebook.imagetensor.ImageTensorModule

/**
 * React Native bridge for [LiteRtEmbeddingEngine]. The JS embedding service
 * selects this Android runtime or ONNX based on the installed artifact.
 * Load, embed, and unload calls share one engine per module instance.
 */
class LiteRtEmbeddingModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "LiteRtEmbeddingModule"
    }

    private val engine = LiteRtEmbeddingEngine()

    override fun getName(): String = NAME

    @ReactMethod
    fun isGpuSupported(promise: Promise) {
        Thread {
            try {
                promise.resolve(LiteRtEmbeddingEngine.isGpuSupported())
            } catch (e: Exception) {
                promise.reject("GPU_CHECK_ERROR", "Failed to check GPU delegate support: ${e.message}", e)
            }
        }.start()
    }

    @ReactMethod
    fun loadModel(modelPath: String, preferGpu: Boolean, promise: Promise) {
        Thread {
            try {
                val result = engine.loadModel(modelPath, preferGpu)
                val map = WritableNativeMap()
                map.putString("runtime", result.runtime.name.lowercase())
                promise.resolve(map)
            } catch (e: LiteRtModelLoadException) {
                promise.reject("MODEL_LOAD_ERROR", e.message, e)
            } catch (e: Exception) {
                promise.reject("MODEL_LOAD_ERROR", "Failed to load LiteRT model: ${e.message}", e)
            }
        }.start()
    }

    @ReactMethod
    fun embedFromUri(
        imageUri: String,
        inputSize: Double,
        mean: ReadableArray,
        std: ReadableArray,
        scale: Double,
        expectedDim: Double,
        promise: Promise,
    ) {
        Thread {
            try {
                val bitmap = loadBitmap(imageUri)
                    ?: return@Thread promise.reject("IMAGE_ERROR", "Could not load image: $imageUri")

                val meanArr = doubleArrayOf(mean.getDouble(0), mean.getDouble(1), mean.getDouble(2))
                val stdArr = doubleArrayOf(std.getDouble(0), std.getDouble(1), std.getDouble(2))
                val size = inputSize.toInt()

                val nchw = ImageTensorModule.bitmapToNchw(
                    bitmap, size, size, meanArr, stdArr, scale, bgr = false,
                )
                bitmap.recycle()

                val startTime = System.nanoTime()
                val embedding = engine.embed(nchw, size, size, expectedDim.toInt())
                val inferenceTimeMs = (System.nanoTime() - startTime) / 1_000_000.0

                val embeddingArray = WritableNativeArray()
                for (v in embedding) {
                    embeddingArray.pushDouble(v.toDouble())
                }
                val result = WritableNativeMap()
                result.putArray("embedding", embeddingArray)
                result.putDouble("inferenceTimeMs", inferenceTimeMs)
                promise.resolve(result)
            } catch (e: IllegalStateException) {
                promise.reject("NOT_LOADED", e.message, e)
            } catch (e: LiteRtEmbeddingDimensionException) {
                promise.reject("DIMENSION_MISMATCH", e.message, e)
            } catch (e: Exception) {
                promise.reject("EMBED_ERROR", "Failed to extract embedding: ${e.message}", e)
            }
        }.start()
    }

    @ReactMethod
    fun unloadModel(promise: Promise) {
        Thread {
            try {
                engine.unload()
                promise.resolve(null)
            } catch (e: Exception) {
                promise.reject("UNLOAD_ERROR", "Failed to unload LiteRT model: ${e.message}", e)
            }
        }.start()
    }

    private fun loadBitmap(uri: String): Bitmap? {
        val parsed = Uri.parse(uri)
        return when (parsed.scheme) {
            "content" -> reactApplicationContext.contentResolver.openInputStream(parsed)?.use { stream ->
                BitmapFactory.decodeStream(stream)
            }
            "file" -> BitmapFactory.decodeFile(parsed.path)
            else -> BitmapFactory.decodeFile(uri)
        }
    }
}
