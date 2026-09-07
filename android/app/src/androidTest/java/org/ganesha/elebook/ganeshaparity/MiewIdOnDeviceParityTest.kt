package org.ganesha.elebook.ganeshaparity

import org.ganesha.elebook.imagetensor.ImageTensorModule
import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.graphics.BitmapFactory
import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.sqrt

/**
 * Golden on-device parity test (Project Ganesha E13-4 / EleBook v3 plan).
 *
 * Confirms the REAL Android inference stack this app ships — native bitmap
 * decode + resize + normalize via [ImageTensorModule.bitmapToNchw] (the exact
 * function `preprocessImageForEmbedding` calls in production), plus the real
 * `com.microsoft.onnxruntime:onnxruntime-android` library this app depends on
 * — reproduces the same MiewID v4.1 embedding Project Ganesha's Python
 * pipeline (`ml/score.py` / `ml/export_onnx.py`) computes for the identical
 * photo.
 *
 * Android's bitmap resize and PIL/torchvision's resize are independent
 * implementations of "squash-resize to 440x440, bilinear". Bit-identical
 * output is NOT expected here (unlike the same-implementation
 * PyTorch-vs-ONNX check in export_onnx.py, which floors at 0.9999) — this is
 * a genuine cross-implementation comparison. [MIN_COSINE] is set well below
 * that same-implementation floor for this reason; the exact measured cosine
 * is always logged regardless of pass/fail so the real number is visible in
 * `adb logcat` / the instrumentation test report, not just a boolean.
 *
 * Requires fixture files staged on the connected device first, at
 * `context.getExternalFilesDir(null)/ganesha_parity/`:
 *   - miewid_v4_1.onnx        (ml/artifacts/miewid_v4_1.onnx)
 *   - test_image.jpg          (the same photo used to compute the reference)
 *   - reference_embedding.bin (ml/dump_reference_embedding.py output)
 *
 * Not run by CI — needs a large (~204MB) model file staged on a physical or
 * emulated device via adb push, which CI does not do.
 */
@RunWith(AndroidJUnit4::class)
class MiewIdOnDeviceParityTest {

    companion object {
        private const val TAG = "GaneshaParity"
        private val MIEWID_MEAN = doubleArrayOf(0.485, 0.456, 0.406)
        private val MIEWID_STD = doubleArrayOf(0.229, 0.224, 0.225)
        private const val MIEWID_SCALE = 1.0 / 255.0
        private const val EMBEDDING_DIM = 2152
        private const val INPUT_SIZE = 440

        // Cross-implementation floor (Android bitmap resize vs PIL resize),
        // not the 0.9999 same-implementation conversion-parity floor.
        private const val MIN_COSINE = 0.98
    }

    @Test
    fun onDeviceEmbeddingMatchesPythonReference() {
        // /data/local/tmp is a plain filesystem path (not FUSE-backed scoped
        // storage under /sdcard/Android/data/<pkg>/), so files an adb shell
        // pushes there are reliably visible to the app's own process — unlike
        // /sdcard/Android/data/<pkg>/files, which can silently hide
        // shell-written files from the app depending on device/FUSE state.
        val fixturesDir = File("/data/local/tmp/ganesha_parity")
        val modelFile = File(fixturesDir, "miewid_v4_1.onnx")
        val imageFile = File(fixturesDir, "test_image.jpg")
        val referenceFile = File(fixturesDir, "reference_embedding.bin")

        assertTrue(
            "Model fixture missing: ${modelFile.absolutePath} — adb push it first",
            modelFile.exists(),
        )
        assertTrue("Image fixture missing: ${imageFile.absolutePath}", imageFile.exists())
        assertTrue(
            "Reference embedding fixture missing: ${referenceFile.absolutePath}",
            referenceFile.exists(),
        )

        // 1. Same production preprocessing path the app itself uses
        // (onnxInferenceService/preprocessing.ts -> ImageTensorModule.imageToTensor
        // -> ImageTensorModule.bitmapToNchw), with MiewID's real ImageNet mean/std
        // and the real 1/255 scale used by preprocessImageForEmbedding.
        val bitmap = BitmapFactory.decodeFile(imageFile.absolutePath)
        assertNotNull("Could not decode ${imageFile.absolutePath}", bitmap)
        val tensorData = ImageTensorModule.bitmapToNchw(
            bitmap!!,
            INPUT_SIZE,
            INPUT_SIZE,
            MIEWID_MEAN,
            MIEWID_STD,
            MIEWID_SCALE,
            bgr = false,
        )
        bitmap.recycle()

        // 2. Same ONNX Runtime Android library this app depends on
        // (com.microsoft.onnxruntime:onnxruntime-android, pinned in
        // android/build.gradle) running our verified miewid_v4_1.onnx graph.
        val env = OrtEnvironment.getEnvironment()
        env.createSession(modelFile.absolutePath, OrtSession.SessionOptions()).use { session ->
            val floatData = FloatArray(tensorData.size) { tensorData[it].toFloat() }
            val floatBuffer = ByteBuffer.allocateDirect(floatData.size * 4)
                .order(ByteOrder.nativeOrder())
                .asFloatBuffer()
            floatBuffer.put(floatData)
            floatBuffer.rewind()

            val shape = longArrayOf(1, 3, INPUT_SIZE.toLong(), INPUT_SIZE.toLong())
            OnnxTensor.createTensor(env, floatBuffer, shape).use { inputTensor ->
                val inputName = session.inputNames.iterator().next()
                session.run(mapOf(inputName to inputTensor)).use { result ->
                    val outputName = session.outputNames.iterator().next()
                    @Suppress("UNCHECKED_CAST")
                    val onDeviceEmbedding =
                        (result.get(outputName).get().value as Array<FloatArray>)[0]

                    assertTrue(
                        "Expected $EMBEDDING_DIM-dim embedding, got ${onDeviceEmbedding.size}",
                        onDeviceEmbedding.size == EMBEDDING_DIM,
                    )

                    // 3. Compare against Python's ONNX-verified reference for the
                    // identical photo (ml/dump_reference_embedding.py).
                    val referenceEmbedding = readFloatsLittleEndian(referenceFile, EMBEDDING_DIM)
                    val cosine = cosineSimilarity(onDeviceEmbedding, referenceEmbedding)
                    val onDeviceNorm = l2Norm(onDeviceEmbedding)
                    val referenceNorm = l2Norm(referenceEmbedding)

                    Log.i(
                        TAG,
                        "on-device vs Python reference: cosine=$cosine " +
                            "onDeviceNorm=$onDeviceNorm referenceNorm=$referenceNorm " +
                            "(raw BatchNorm output, NOT L2-normalized by design)",
                    )
                    println(
                        "GANESHA_PARITY_RESULT cosine=$cosine " +
                            "onDeviceNorm=$onDeviceNorm referenceNorm=$referenceNorm",
                    )

                    assertTrue(
                        "On-device MiewID embedding diverged from Python reference: " +
                            "cosine=$cosine (floor=$MIN_COSINE)",
                        cosine >= MIN_COSINE,
                    )
                }
            }
        }
    }

    private fun readFloatsLittleEndian(file: File, count: Int): FloatArray {
        val buffer = ByteBuffer.wrap(file.readBytes()).order(ByteOrder.LITTLE_ENDIAN)
        return FloatArray(count) { buffer.getFloat(it * 4) }
    }

    private fun l2Norm(vector: FloatArray): Double {
        var sumSquares = 0.0
        for (value in vector) sumSquares += value.toDouble() * value.toDouble()
        return sqrt(sumSquares)
    }

    private fun cosineSimilarity(a: FloatArray, b: FloatArray): Double {
        var dot = 0.0
        var normA = 0.0
        var normB = 0.0
        for (i in a.indices) {
            dot += a[i].toDouble() * b[i].toDouble()
            normA += a[i].toDouble() * a[i].toDouble()
            normB += b[i].toDouble() * b[i].toDouble()
        }
        val denom = sqrt(normA) * sqrt(normB)
        return if (denom == 0.0) 0.0 else dot / denom
    }
}
