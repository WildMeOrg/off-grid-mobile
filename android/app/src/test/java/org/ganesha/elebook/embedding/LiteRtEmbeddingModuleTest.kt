package org.ganesha.elebook.embedding

import android.app.Application
import android.graphics.Bitmap
import com.facebook.react.bridge.JavaOnlyArray
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.mockito.kotlin.any
import org.mockito.kotlin.doAnswer
import org.mockito.kotlin.mock
import org.mockito.kotlin.verify
import org.mockito.kotlin.whenever
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], application = Application::class)
class LiteRtEmbeddingModuleTest {
    @get:Rule
    val temporaryFolder = TemporaryFolder()

    @Test
    fun `bridge operations and invalidation use the same worker in order`() {
        val engine = mock<LiteRtEmbeddingEngine>()
        val calls = Collections.synchronizedList(mutableListOf<Pair<String, Thread>>())
        val completed = CountDownLatch(4)
        doAnswer {
            calls.add("load" to Thread.currentThread())
            completed.countDown()
            throw LiteRtModelLoadException("test load")
        }.whenever(engine).loadModel(any(), any())
        doAnswer {
            calls.add("embed" to Thread.currentThread())
            completed.countDown()
            throw IllegalStateException("test inference")
        }.whenever(engine).embed(any(), any(), any(), any())
        doAnswer {
            calls.add("unload" to Thread.currentThread())
            completed.countDown()
            null
        }.whenever(engine).unload()
        val context = mock<ReactApplicationContext>()
        val module = LiteRtEmbeddingModule(context, engine)
        val photo = temporaryFolder.newFile("pixel.png")
        val bitmap = Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888)
        photo.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()

        try {
            module.loadModel("test.tflite", true, mock())
            module.embedFromUri(
                photo.absolutePath, 1.0,
                JavaOnlyArray.of(0.0, 0.0, 0.0), JavaOnlyArray.of(1.0, 1.0, 1.0),
                1.0, 3.0, mock(),
            )
            module.unloadModel(mock())
            module.invalidate()

            assertTrue(completed.await(10, TimeUnit.SECONDS))
            assertEquals(listOf("load", "embed", "unload", "unload"), calls.map { it.first })
            assertEquals(1, calls.map { it.second }.distinct().size)
            assertNotEquals(Thread.currentThread(), calls.first().second)
        } finally {
            module.invalidate()
        }
    }

    @Test
    fun `calls after invalidation reject instead of starting another worker`() {
        val context = mock<ReactApplicationContext>()
        val module = LiteRtEmbeddingModule(context, mock())
        val promise = mock<Promise>()

        module.invalidate()
        module.loadModel("test.tflite", true, promise)

        verify(promise).reject("MODULE_INVALIDATED", "LiteRT module is no longer available")
    }
}