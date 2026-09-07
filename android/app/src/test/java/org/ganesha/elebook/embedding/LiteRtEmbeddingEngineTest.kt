package org.ganesha.elebook.embedding

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Test

class LiteRtEmbeddingEngineTest {

    // -------------------------------------------------------------------------
    // nchwToNhwc -- pure array math, no native TFLite dependency
    // -------------------------------------------------------------------------

    @Test
    fun `nchwToNhwc reorders a single pixel from planar to interleaved`() {
        // NCHW for a 1x1 image: [R, G, B] each in their own plane of size 1.
        val nchw = doubleArrayOf(10.0, 20.0, 30.0)

        val nhwc = LiteRtEmbeddingEngine.nchwToNhwc(nchw, height = 1, width = 1)

        assertEquals(3, nhwc.size)
        assertEquals(10.0f, nhwc[0])
        assertEquals(20.0f, nhwc[1])
        assertEquals(30.0f, nhwc[2])
    }

    @Test
    fun `nchwToNhwc reorders a 2x2 image preserving per-pixel channel grouping`() {
        // Planar NCHW: R-plane (4 values), G-plane (4 values), B-plane (4 values).
        val plane = 4
        val nchw = DoubleArray(3 * plane) { index ->
            when {
                index < plane -> 100.0 + index // R plane: 100,101,102,103
                index < 2 * plane -> 200.0 + (index - plane) // G plane: 200..203
                else -> 300.0 + (index - 2 * plane) // B plane: 300..303
            }
        }

        val nhwc = LiteRtEmbeddingEngine.nchwToNhwc(nchw, height = 2, width = 2)

        assertEquals(12, nhwc.size)
        // Pixel 0 (row0,col0): R=100, G=200, B=300
        assertEquals(100.0f, nhwc[0])
        assertEquals(200.0f, nhwc[1])
        assertEquals(300.0f, nhwc[2])
        // Pixel 3 (row1,col1, last pixel): R=103, G=203, B=303
        assertEquals(103.0f, nhwc[9])
        assertEquals(203.0f, nhwc[10])
        assertEquals(303.0f, nhwc[11])
    }

    // -------------------------------------------------------------------------
    // embed() / isModelLoaded() -- guard clauses that don't touch the native
    // interpreter, so they're safe to exercise without a real device.
    // -------------------------------------------------------------------------

    @Test
    fun `isModelLoaded is false before any model is loaded`() {
        val engine = LiteRtEmbeddingEngine()

        assertFalse(engine.isModelLoaded("/some/model.tflite"))
    }

    @Test
    fun `embed throws IllegalStateException when no model is loaded`() {
        val engine = LiteRtEmbeddingEngine()

        assertThrows(IllegalStateException::class.java) {
            engine.embed(DoubleArray(3), height = 1, width = 1, expectedDim = 2152)
        }
    }

    @Test
    fun `unload is a safe no-op when nothing is loaded`() {
        val engine = LiteRtEmbeddingEngine()

        engine.unload()

        assertFalse(engine.isModelLoaded("/some/model.tflite"))
    }
}
