package org.ganesha.elebook.ganeshaparity

import org.ganesha.elebook.imagetensor.ImageTensorModule
import android.graphics.BitmapFactory
import android.os.Debug
import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.tensorflow.lite.Interpreter
import org.tensorflow.lite.gpu.CompatibilityList
import org.tensorflow.lite.gpu.GpuDelegate
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.Locale
import kotlin.math.sqrt

/**
 * On-device LiteRT CPU/GPU latency, memory, and reference-cosine benchmark.
 * Uses the same warmup counts and PSS measurement as
 * [MiewIdOnDeviceBenchmarkTest] for comparisons on the same device.
 *
 * Requires fixtures staged at `/data/local/tmp/ganesha_parity/`:
 *   - miewid_v4_1.tflite and reference_embedding.bin (440x440)
 *   - miewid_v4_1_320.tflite and reference_embedding_320.bin (320x320)
 *   - test_image.jpg
 *
 * Missing model pairs are skipped; delegate failures are logged rather
 * than asserted. Passing this benchmark is not a runtime acceptance gate.
 */
@RunWith(AndroidJUnit4::class)
class MiewIdLiteRtBenchmarkTest {

    companion object {
        private const val TAG = "GaneshaBenchmark"
        private val MIEWID_MEAN = doubleArrayOf(0.485, 0.456, 0.406)
        private val MIEWID_STD = doubleArrayOf(0.229, 0.224, 0.225)
        private const val MIEWID_SCALE = 1.0 / 255.0
        private const val EMBEDDING_DIM = 2152
        private const val WARMUP_RUNS = 3
        private const val TIMED_RUNS = 10
    }

    private fun totalPssKb(): Int {
        val memInfo = Debug.MemoryInfo()
        Debug.getMemoryInfo(memInfo)
        return memInfo.totalPss
    }

    private data class SizeConfig(
        val label: String,
        val modelFilename: String,
        val referenceFilename: String,
        val inputSize: Int,
    )

    @Test
    fun benchmarkLiteRtCpuAndGpu() {
        val fixturesDir = File("/data/local/tmp/ganesha_parity")
        val imageFile = File(fixturesDir, "test_image.jpg")
        assertTrue("Image fixture missing: ${imageFile.absolutePath}", imageFile.exists())

        val sizeConfigs = listOf(
            SizeConfig("440px", "miewid_v4_1.tflite", "reference_embedding.bin", 440),
            SizeConfig("320px", "miewid_v4_1_320.tflite", "reference_embedding_320.bin", 320),
        )
        val compatList = CompatibilityList()
        val summary = StringBuilder("\n=== GANESHA LITERT BENCHMARK ===\n")
        summary.append(
            "GPU delegate supported on this device: ${compatList.isDelegateSupportedOnThisDevice}\n",
        )

        for (sizeConfig in sizeConfigs) {
            val modelFile = File(fixturesDir, sizeConfig.modelFilename)
            val referenceFile = File(fixturesDir, sizeConfig.referenceFilename)
            if (!modelFile.exists() || !referenceFile.exists()) {
                val line = "%-16s SKIPPED — fixture missing (%s exists=%b, %s exists=%b)".format(
                    Locale.US, sizeConfig.label,
                    modelFile.name, modelFile.exists(), referenceFile.name, referenceFile.exists(),
                )
                Log.w(TAG, line)
                summary.append(line).append('\n')
                continue
            }
            val referenceEmbedding = readFloatsLittleEndian(referenceFile, EMBEDDING_DIM)

            val bitmap = BitmapFactory.decodeFile(imageFile.absolutePath)
            assertTrue("Could not decode ${imageFile.absolutePath}", bitmap != null)
            // The shared preprocessor emits NCHW; the TFLite artifact requires NHWC.
            val tensorDataNchw = ImageTensorModule.bitmapToNchw(
                bitmap!!, sizeConfig.inputSize, sizeConfig.inputSize,
                MIEWID_MEAN, MIEWID_STD, MIEWID_SCALE, bgr = false,
            )
            bitmap.recycle()
            val floatDataNhwc = nchwToNhwc(tensorDataNchw, sizeConfig.inputSize, sizeConfig.inputSize)
            val modelBytes = readModelFileToDirectBuffer(modelFile)

            val cpuLine = runConfig(
                "${sizeConfig.label}/LiteRT-CPU", modelBytes, floatDataNhwc,
                useGpu = false, compatList, referenceEmbedding,
            )
            Log.i(TAG, cpuLine)
            summary.append(cpuLine).append('\n')

            val gpuLine = runConfig(
                "${sizeConfig.label}/LiteRT-GPU", modelBytes, floatDataNhwc,
                useGpu = true, compatList, referenceEmbedding,
            )
            Log.i(TAG, gpuLine)
            summary.append(gpuLine).append('\n')
        }

        Log.i(TAG, summary.toString())
        println("GANESHA_LITERT_BENCHMARK_RESULT$summary")
        assertTrue(true)
    }

    private fun readFloatsLittleEndian(file: File, count: Int): FloatArray {
        val buffer = ByteBuffer.wrap(file.readBytes()).order(ByteOrder.LITTLE_ENDIAN)
        return FloatArray(count) { buffer.getFloat(it * 4) }
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

    private fun nchwToNhwc(nchw: DoubleArray, height: Int, width: Int): FloatArray {
        val nhwc = FloatArray(nchw.size)
        val plane = height * width
        for (row in 0 until height) {
            for (col in 0 until width) {
                val pixelIndex = row * width + col
                val nhwcBase = pixelIndex * 3
                nhwc[nhwcBase] = nchw[pixelIndex].toFloat()
                nhwc[nhwcBase + 1] = nchw[plane + pixelIndex].toFloat()
                nhwc[nhwcBase + 2] = nchw[2 * plane + pixelIndex].toFloat()
            }
        }
        return nhwc
    }

    private fun readModelFileToDirectBuffer(file: File): ByteBuffer {
        val bytes = file.readBytes()
        val buffer = ByteBuffer.allocateDirect(bytes.size).order(ByteOrder.nativeOrder())
        buffer.put(bytes)
        buffer.rewind()
        return buffer
    }

    private fun runConfig(
        name: String,
        modelBytes: ByteBuffer,
        floatDataNhwc: FloatArray,
        useGpu: Boolean,
        compatList: CompatibilityList,
        referenceEmbedding: FloatArray,
    ): String {
        return try {
            if (useGpu && !compatList.isDelegateSupportedOnThisDevice) {
                return "%-16s SKIPPED — GPU delegate not supported on this device".format(Locale.US, name)
            }

            val memBeforeLoad = totalPssKb()
            val options = Interpreter.Options()
            var gpuDelegate: GpuDelegate? = null
            if (useGpu) {
                val delegateOptions = compatList.bestOptionsForThisDevice
                gpuDelegate = GpuDelegate(delegateOptions)
                options.addDelegate(gpuDelegate)
            }

            val loadStart = System.nanoTime()
            modelBytes.rewind()
            val interpreter = Interpreter(modelBytes, options)
            val loadMs = (System.nanoTime() - loadStart) / 1_000_000.0
            val memAfterLoad = totalPssKb()

            val inputBuffer = ByteBuffer.allocateDirect(floatDataNhwc.size * 4)
                .order(ByteOrder.nativeOrder())
            val outputBuffer = ByteBuffer.allocateDirect(EMBEDDING_DIM * 4)
                .order(ByteOrder.nativeOrder())

            val latenciesMs = mutableListOf<Double>()
            var lastEmbedding = FloatArray(EMBEDDING_DIM)
            repeat(WARMUP_RUNS + TIMED_RUNS) { iteration ->
                inputBuffer.rewind()
                val floatView = inputBuffer.asFloatBuffer()
                floatView.put(floatDataNhwc)
                inputBuffer.rewind()
                outputBuffer.rewind()

                val start = System.nanoTime()
                interpreter.run(inputBuffer, outputBuffer)
                val elapsedMs = (System.nanoTime() - start) / 1_000_000.0
                if (iteration >= WARMUP_RUNS) latenciesMs.add(elapsedMs)

                // Every run should produce the identical embedding for a
                // fixed input — capture the last one as this config's result
                // (correctness check, not just a speed benchmark).
                outputBuffer.rewind()
                val outFloatView = outputBuffer.asFloatBuffer()
                lastEmbedding = FloatArray(EMBEDDING_DIM) { outFloatView.get(it) }
            }
            val memAfterInference = totalPssKb()
            interpreter.close()
            gpuDelegate?.close()

            val cosineVsReference = cosineSimilarity(lastEmbedding, referenceEmbedding)

            latenciesMs.sort()
            val min = latenciesMs.first()
            val max = latenciesMs.last()
            val median = latenciesMs[latenciesMs.size / 2]
            val mean = latenciesMs.average()

            (
                "%-16s load=%6.1fms  inference[min=%6.1f median=%6.1f mean=%6.1f max=%6.1fms]  " +
                    "cosVsPythonRef=%.8f  " +
                    "pssKb[beforeLoad=%d afterLoad=%d(+%d) afterInference=%d(+%d)]"
            ).format(
                Locale.US,
                name, loadMs, min, median, mean, max,
                cosineVsReference,
                memBeforeLoad, memAfterLoad, memAfterLoad - memBeforeLoad,
                memAfterInference, memAfterInference - memAfterLoad,
            )
        } catch (e: Exception) {
            "%-16s FAILED TO INITIALIZE — %s: %s".format(Locale.US, name, e.javaClass.simpleName, e.message)
        }
    }
}
