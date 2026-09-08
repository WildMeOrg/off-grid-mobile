package org.ganesha.elebook.ganeshaparity

import org.ganesha.elebook.imagetensor.ImageTensorModule
import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import ai.onnxruntime.providers.NNAPIFlags
import android.graphics.BitmapFactory
import android.os.Debug
import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.EnumSet
import java.util.Locale

/**
 * On-device latency/memory benchmark (Project Ganesha E13-5 / EleBook v3 plan).
 *
 * Decides between candidate ONNX Runtime Android execution providers, and
 * between the 440x440 (deployment default) and 320x320 (halved-compute
 * candidate — see docs/ANDROID_ONDEVICE_FEASIBILITY.md #8, "cheapest
 * available win") input contracts for the MiewID v4.1 backbone. Measures
 * real process memory footprint (`Debug.MemoryInfo.totalPss`, which covers
 * native + Java heap + graphics — the ORT C++ session lives off the JVM
 * heap, so `Runtime.totalMemory()` alone would be misleading).
 *
 * Google deprecated NNAPI as of Android 15 (API 35) in favor of app-managed
 * accelerator selection; this device runs Android 16 (API 36). This
 * benchmark measures directly whether NNAPI still initializes and helps here
 * rather than assuming either way — see docs/ANDROID_ONDEVICE_FEASIBILITY.md
 * #3 ("Do not build the performance plan on ONNX Runtime + NNAPI").
 *
 * This is a measurement tool, not a pass/fail gate: it always "passes" (a
 * provider failing to initialize is itself a valid, logged result) and
 * prints the real numbers to `adb logcat -s GaneshaBenchmark:I` and stdout
 * (visible via `adb shell am instrument -w`). Not run by CI — needs large
 * (~204MB each) model files staged on a connected device via adb push.
 *
 * Requires fixtures staged at `/data/local/tmp/ganesha_parity/`:
 *   - miewid_v4_1.onnx      (440x440 — ml/export_onnx.py)
 *   - miewid_v4_1_320.onnx  (320x320 — ml/export_onnx.py --size 320)
 *   - test_image.jpg
 */
@RunWith(AndroidJUnit4::class)
class MiewIdOnDeviceBenchmarkTest {

    companion object {
        private const val TAG = "GaneshaBenchmark"
        private val MIEWID_MEAN = doubleArrayOf(0.485, 0.456, 0.406)
        private val MIEWID_STD = doubleArrayOf(0.229, 0.224, 0.225)
        private const val MIEWID_SCALE = 1.0 / 255.0
        private const val WARMUP_RUNS = 3
        private const val TIMED_RUNS = 10
    }

    private data class SizeConfig(val label: String, val modelFilename: String, val inputSize: Int)

    private fun totalPssKb(): Int {
        val memInfo = Debug.MemoryInfo()
        Debug.getMemoryInfo(memInfo)
        return memInfo.totalPss
    }

    @Test
    fun benchmarkExecutionProvidersAndInputSizes() {
        val fixturesDir = File("/data/local/tmp/ganesha_parity")
        val imageFile = File(fixturesDir, "test_image.jpg")
        assertTrue("Image fixture missing: ${imageFile.absolutePath}", imageFile.exists())

        val sizeConfigs = listOf(
            SizeConfig("440px", "miewid_v4_1.onnx", 440),
            SizeConfig("320px", "miewid_v4_1_320.onnx", 320),
        )
        val providerConfigs: List<Pair<String, (OrtSession.SessionOptions) -> Unit>> = listOf(
            "CPU" to { _: OrtSession.SessionOptions -> },
            "XNNPACK" to { opts: OrtSession.SessionOptions -> opts.addXnnpack(emptyMap()) },
            "NNAPI" to { opts: OrtSession.SessionOptions -> opts.addNnapi(EnumSet.noneOf(NNAPIFlags::class.java)) },
        )

        val env = OrtEnvironment.getEnvironment()
        val summary = StringBuilder("\n=== GANESHA ON-DEVICE BENCHMARK (Pixel 9a, Android 16) ===\n")

        for (sizeConfig in sizeConfigs) {
            val modelFile = File(fixturesDir, sizeConfig.modelFilename)
            if (!modelFile.exists()) {
                val line = "%-6s SKIPPED — model fixture missing: %s".format(
                    Locale.US, sizeConfig.label, modelFile.absolutePath,
                )
                Log.w(TAG, line)
                summary.append(line).append('\n')
                continue
            }

            val bitmap = BitmapFactory.decodeFile(imageFile.absolutePath)
            assertTrue("Could not decode ${imageFile.absolutePath}", bitmap != null)
            val tensorData = ImageTensorModule.bitmapToNchw(
                bitmap!!, sizeConfig.inputSize, sizeConfig.inputSize,
                MIEWID_MEAN, MIEWID_STD, MIEWID_SCALE, bgr = false,
            )
            bitmap.recycle()
            val floatData = FloatArray(tensorData.size) { tensorData[it].toFloat() }
            val shape = longArrayOf(1, 3, sizeConfig.inputSize.toLong(), sizeConfig.inputSize.toLong())

            for ((providerName, configure) in providerConfigs) {
                val label = "${sizeConfig.label}/$providerName"
                val line = runOneConfig(label, configure, env, modelFile, floatData, shape)
                Log.i(TAG, line)
                summary.append(line).append('\n')
            }
        }

        Log.i(TAG, summary.toString())
        println("GANESHA_BENCHMARK_RESULT$summary")
        // Always passes: a provider failing to initialize is itself a valid,
        // already-logged result, not a test failure.
        assertTrue(true)
    }

    private fun runOneConfig(
        name: String,
        configure: (OrtSession.SessionOptions) -> Unit,
        env: OrtEnvironment,
        modelFile: File,
        floatData: FloatArray,
        shape: LongArray,
    ): String {
        return try {
            val memBeforeLoad = totalPssKb()
            val opts = OrtSession.SessionOptions()
            configure(opts)

            val loadStart = System.nanoTime()
            val session = env.createSession(modelFile.absolutePath, opts)
            val loadMs = (System.nanoTime() - loadStart) / 1_000_000.0
            val memAfterLoad = totalPssKb()

            val inputName = session.inputNames.iterator().next()
            val latenciesMs = mutableListOf<Double>()
            repeat(WARMUP_RUNS + TIMED_RUNS) { iteration ->
                val floatBuffer = ByteBuffer.allocateDirect(floatData.size * 4)
                    .order(ByteOrder.nativeOrder())
                    .asFloatBuffer()
                floatBuffer.put(floatData)
                floatBuffer.rewind()
                OnnxTensor.createTensor(env, floatBuffer, shape).use { input ->
                    val start = System.nanoTime()
                    session.run(mapOf(inputName to input)).use { }
                    val elapsedMs = (System.nanoTime() - start) / 1_000_000.0
                    if (iteration >= WARMUP_RUNS) latenciesMs.add(elapsedMs)
                }
            }
            val memAfterInference = totalPssKb()
            session.close()

            latenciesMs.sort()
            val min = latenciesMs.first()
            val max = latenciesMs.last()
            val median = latenciesMs[latenciesMs.size / 2]
            val mean = latenciesMs.average()

            (
                "%-16s load=%6.1fms  inference[min=%6.1f median=%6.1f mean=%6.1f max=%6.1fms]  " +
                    "pssKb[beforeLoad=%d afterLoad=%d(+%d) afterInference=%d(+%d)]"
            ).format(
                Locale.US,
                name, loadMs, min, median, mean, max,
                memBeforeLoad, memAfterLoad, memAfterLoad - memBeforeLoad,
                memAfterInference, memAfterInference - memAfterLoad,
            )
        } catch (e: Exception) {
            "%-16s FAILED TO INITIALIZE — %s: %s".format(Locale.US, name, e.javaClass.simpleName, e.message)
        }
    }
}
