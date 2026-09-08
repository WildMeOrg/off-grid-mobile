package org.ganesha.elebook.imagetensor

import android.graphics.Bitmap
import android.graphics.Color
import android.app.Application
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], application = Application::class)
class ImageTensorModuleTest {

    @get:Rule
    val tmp = TemporaryFolder()

    // -------------------------------------------------------------------------
    // bitmapToNchw
    // -------------------------------------------------------------------------

    @Test
    fun `bitmapToNchw returns correct size for 2x2 RGB`() {
        val bmp = Bitmap.createBitmap(2, 2, Bitmap.Config.ARGB_8888)
        val output = ImageTensorModule.bitmapToNchw(
            bmp, 2, 2,
            doubleArrayOf(0.0, 0.0, 0.0),
            doubleArrayOf(1.0, 1.0, 1.0),
            1.0, false,
        )
        assertEquals(3 * 2 * 2, output.size)
        bmp.recycle()
    }

    @Test
    fun `bitmapToNchw identity normalization on red pixel`() {
        val bmp = Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888)
        bmp.setPixel(0, 0, Color.RED) // ARGB = 0xFFFF0000 → R=255, G=0, B=0

        val output = ImageTensorModule.bitmapToNchw(
            bmp, 1, 1,
            doubleArrayOf(0.0, 0.0, 0.0),
            doubleArrayOf(1.0, 1.0, 1.0),
            1.0, false,
        )
        // NCHW: [R, G, B] for a 1x1 image
        assertEquals(255.0, output[0], 0.001) // R
        assertEquals(0.0, output[1], 0.001)   // G
        assertEquals(0.0, output[2], 0.001)   // B
        bmp.recycle()
    }

    @Test
    fun `bitmapToNchw with scale 1 over 255 normalizes to 0-1 range`() {
        // Per EMBEDDING_PACK_FORMAT.md, scale is a MULTIPLIER (e.g. 1/255) applied before mean/std.
        val bmp = Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888)
        bmp.setPixel(0, 0, Color.rgb(255, 128, 0))

        val output = ImageTensorModule.bitmapToNchw(
            bmp, 1, 1,
            doubleArrayOf(0.0, 0.0, 0.0),
            doubleArrayOf(1.0, 1.0, 1.0),
            1.0 / 255.0, false,
        )
        assertEquals(1.0, output[0], 0.01)          // R: 255 * 1/255
        assertEquals(128.0 / 255.0, output[1], 0.01) // G: 128 * 1/255
        assertEquals(0.0, output[2], 0.01)            // B: 0 * 1/255
        bmp.recycle()
    }

    @Test
    fun `bitmapToNchw with ImageNet normalization applies scale as multiplier`() {
        val bmp = Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888)
        bmp.setPixel(0, 0, Color.rgb(128, 128, 128))

        val mean = doubleArrayOf(0.485, 0.456, 0.406)
        val std = doubleArrayOf(0.229, 0.224, 0.225)

        val output = ImageTensorModule.bitmapToNchw(
            bmp, 1, 1, mean, std, 1.0 / 255.0, false,
        )
        // Formula: (pixel * scale - mean) / std → (128 * 1/255 - 0.485) / 0.229 ≈ 0.0682
        val expected = (128.0 * (1.0 / 255.0) - 0.485) / 0.229
        assertEquals(expected, output[0], 0.001)
        bmp.recycle()
    }

    @Test
    fun `bitmapToNchw MiewID parity fixture — solid red 255 with ImageNet norm`() {
        // Golden parity fixture: this is the NumPy-computed expected output for a 1×1 pure-red
        // pixel passed through MiewID's preprocessing path (ImageNet mean/std, scale = 1/255).
        //   R: (255/255 - 0.485) / 0.229 = (1 - 0.485) / 0.229 ≈ 2.2489...
        //   G: (0   - 0.456) / 0.224 ≈ -2.0357...
        //   B: (0   - 0.406) / 0.225 ≈ -1.8044...
        // If any of these drift, MiewID embeddings will be garbage. Fail loudly.
        val bmp = Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888)
        bmp.setPixel(0, 0, Color.RED)

        val output = ImageTensorModule.bitmapToNchw(
            bmp, 1, 1,
            doubleArrayOf(0.485, 0.456, 0.406),
            doubleArrayOf(0.229, 0.224, 0.225),
            1.0 / 255.0, false,
        )
        assertEquals(2.2489083, output[0], 1e-4)
        assertEquals(-2.0357143, output[1], 1e-4)
        assertEquals(-1.8044444, output[2], 1e-4)
        bmp.recycle()
    }

    @Test
    fun `bitmapToNchw BGR swaps channels 0 and 2`() {
        val bmp = Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888)
        bmp.setPixel(0, 0, Color.RED) // R=255, G=0, B=0

        val output = ImageTensorModule.bitmapToNchw(
            bmp, 1, 1,
            doubleArrayOf(0.0, 0.0, 0.0),
            doubleArrayOf(1.0, 1.0, 1.0),
            1.0, bgr = true,
        )
        // BGR: channel 0 = B, channel 1 = G, channel 2 = R
        assertEquals(0.0, output[0], 0.001)   // B
        assertEquals(0.0, output[1], 0.001)   // G
        assertEquals(255.0, output[2], 0.001) // R
        bmp.recycle()
    }

    @Test
    fun `bitmapToNchw NCHW layout for 2x2 image`() {
        val bmp = Bitmap.createBitmap(2, 2, Bitmap.Config.ARGB_8888)
        bmp.setPixel(0, 0, Color.RED)
        bmp.setPixel(1, 0, Color.GREEN)
        bmp.setPixel(0, 1, Color.BLUE)
        bmp.setPixel(1, 1, Color.WHITE)

        val output = ImageTensorModule.bitmapToNchw(
            bmp, 2, 2,
            doubleArrayOf(0.0, 0.0, 0.0),
            doubleArrayOf(1.0, 1.0, 1.0),
            1.0, false,
        )
        // R channel (indices 0..3): RED=255, GREEN=0, BLUE=0, WHITE=255
        assertEquals(255.0, output[0], 0.001)
        assertEquals(0.0, output[1], 0.001)
        assertEquals(0.0, output[2], 0.001)
        assertEquals(255.0, output[3], 0.001)

        // G channel (indices 4..7): RED=0, GREEN=255, BLUE=0, WHITE=255
        assertEquals(0.0, output[4], 0.001)
        assertEquals(255.0, output[5], 0.001)
        assertEquals(0.0, output[6], 0.001)
        assertEquals(255.0, output[7], 0.001)

        // B channel (indices 8..11): RED=0, GREEN=0, BLUE=255, WHITE=255
        assertEquals(0.0, output[8], 0.001)
        assertEquals(0.0, output[9], 0.001)
        assertEquals(255.0, output[10], 0.001)
        assertEquals(255.0, output[11], 0.001)

        bmp.recycle()
    }

    @Test
    fun `bitmapToNchw resizes when dimensions differ`() {
        val bmp = Bitmap.createBitmap(100, 100, Bitmap.Config.ARGB_8888)
        val output = ImageTensorModule.bitmapToNchw(
            bmp, 10, 10,
            doubleArrayOf(0.0, 0.0, 0.0),
            doubleArrayOf(1.0, 1.0, 1.0),
            1.0, false,
        )
        assertEquals(3 * 10 * 10, output.size)
        bmp.recycle()
    }

    // -------------------------------------------------------------------------
    // cropAndSave
    // -------------------------------------------------------------------------

    @Test
    fun `cropAndSave creates output file`() {
        val bmp = Bitmap.createBitmap(100, 100, Bitmap.Config.ARGB_8888)
        val outPath = File(tmp.root, "crop.jpg").absolutePath

        ImageTensorModule.cropAndSave(bmp, 0.25, 0.25, 0.5, 0.5, outPath)

        assertTrue(File(outPath).exists())
        assertTrue(File(outPath).length() > 0)
        bmp.recycle()
    }

    @Test
    fun `cropAndSave creates parent directories`() {
        val bmp = Bitmap.createBitmap(100, 100, Bitmap.Config.ARGB_8888)
        val outPath = File(tmp.root, "sub/dir/crop.jpg").absolutePath

        ImageTensorModule.cropAndSave(bmp, 0.0, 0.0, 1.0, 1.0, outPath)

        assertTrue(File(outPath).exists())
        bmp.recycle()
    }

    @Test
    fun `cropAndSave clamps coordinates to image bounds`() {
        val bmp = Bitmap.createBitmap(100, 100, Bitmap.Config.ARGB_8888)
        val outPath = File(tmp.root, "clamped.jpg").absolutePath

        // x + width > 1.0 — should be clamped
        ImageTensorModule.cropAndSave(bmp, 0.8, 0.8, 0.5, 0.5, outPath)

        assertTrue(File(outPath).exists())
        bmp.recycle()
    }
}
