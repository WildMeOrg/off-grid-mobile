package org.ganesha.elebook.ganeshaparity

import android.graphics.BitmapFactory
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.ganesha.elebook.embedding.LiteRtEmbeddingEngine
import org.ganesha.elebook.embedding.LiteRtRuntime
import org.ganesha.elebook.imagetensor.ImageTensorModule
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.sqrt

/**
 * Compares the production [LiteRtEmbeddingEngine] against reference
 * embeddings. Requires model, image, and reference fixtures staged at
 * `/data/local/tmp/ganesha_parity/`; this is not a latency benchmark.
 */
@RunWith(AndroidJUnit4::class)
class LiteRtEmbeddingEngineOnDeviceTest {

    companion object {
        private val MIEWID_MEAN = doubleArrayOf(0.485, 0.456, 0.406)
        private val MIEWID_STD = doubleArrayOf(0.229, 0.224, 0.225)
        private const val MIEWID_SCALE = 1.0 / 255.0
        private const val EMBEDDING_DIM = 2152
        private const val INPUT_SIZE = 440
        private const val MIN_COSINE_VS_REFERENCE = 0.98
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

    private fun readFloatsLittleEndian(file: File, count: Int): FloatArray {
        val buffer = ByteBuffer.wrap(file.readBytes()).order(ByteOrder.LITTLE_ENDIAN)
        return FloatArray(count) { buffer.getFloat(it * 4) }
    }

    @Test
    fun embedMatchesReferenceOnGpuAndCpu() {
        val fixturesDir = File("/data/local/tmp/ganesha_parity")
        val modelFile = File(fixturesDir, "miewid_v4_1.tflite")
        val imageFile = File(fixturesDir, "test_image.jpg")
        val referenceFile = File(fixturesDir, "reference_embedding.bin")
        assertTrue("Model fixture missing: ${modelFile.absolutePath}", modelFile.exists())
        assertTrue("Image fixture missing: ${imageFile.absolutePath}", imageFile.exists())
        assertTrue("Reference fixture missing: ${referenceFile.absolutePath}", referenceFile.exists())

        val referenceEmbedding = readFloatsLittleEndian(referenceFile, EMBEDDING_DIM)
        val bitmap = BitmapFactory.decodeFile(imageFile.absolutePath)
        assertTrue("Could not decode ${imageFile.absolutePath}", bitmap != null)
        val nchw = ImageTensorModule.bitmapToNchw(
            bitmap!!, INPUT_SIZE, INPUT_SIZE, MIEWID_MEAN, MIEWID_STD, MIEWID_SCALE, bgr = false,
        )
        bitmap.recycle()

        val summary = StringBuilder("\n=== LiteRtEmbeddingEngine on-device parity ===\n")

        val gpuEngine = LiteRtEmbeddingEngine()
        val gpuLoad = gpuEngine.loadModel(modelFile.absolutePath, preferGpu = true)
        val gpuEmbedding = gpuEngine.embed(nchw, INPUT_SIZE, INPUT_SIZE, EMBEDDING_DIM)
        val gpuCosine = cosineSimilarity(gpuEmbedding, referenceEmbedding)
        summary.append("runtime=${gpuLoad.runtime} cosineVsReference=$gpuCosine\n")
        gpuEngine.unload()

        val cpuEngine = LiteRtEmbeddingEngine()
        val cpuLoad = cpuEngine.loadModel(modelFile.absolutePath, preferGpu = false)
        val cpuEmbedding = cpuEngine.embed(nchw, INPUT_SIZE, INPUT_SIZE, EMBEDDING_DIM)
        val cpuCosine = cosineSimilarity(cpuEmbedding, referenceEmbedding)
        summary.append("runtime=${cpuLoad.runtime} cosineVsReference=$cpuCosine\n")
        cpuEngine.unload()

        println("GANESHA_ENGINE_PARITY_RESULT$summary")
        assertEquals(LiteRtRuntime.CPU, cpuLoad.runtime)
        assertTrue("GPU cosine similarity too low: $gpuCosine", gpuCosine >= MIN_COSINE_VS_REFERENCE)
        assertTrue("CPU cosine similarity too low: $cpuCosine", cpuCosine >= MIN_COSINE_VS_REFERENCE)
    }

    @Test
    fun loadModelIsIdempotentForTheSamePathAndUnloadClearsIt() {
        val modelFile = File("/data/local/tmp/ganesha_parity", "miewid_v4_1.tflite")
        assertTrue("Model fixture missing: ${modelFile.absolutePath}", modelFile.exists())

        val engine = LiteRtEmbeddingEngine()
        val first = engine.loadModel(modelFile.absolutePath, preferGpu = false)
        val second = engine.loadModel(modelFile.absolutePath, preferGpu = false)

        assertEquals(first.runtime, second.runtime)
        assertTrue(engine.isModelLoaded(modelFile.absolutePath))

        engine.unload()

        assertTrue(!engine.isModelLoaded(modelFile.absolutePath))
    }
}
