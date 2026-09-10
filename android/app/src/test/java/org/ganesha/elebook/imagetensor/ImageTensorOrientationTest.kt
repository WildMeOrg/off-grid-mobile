package org.ganesha.elebook.imagetensor

import android.app.Application
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.BitmapFactory
import androidx.exifinterface.media.ExifInterface
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.mockito.kotlin.any
import org.mockito.kotlin.doAnswer
import org.mockito.kotlin.mock
import org.mockito.kotlin.whenever
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * EXIF orientation parity between the detector grid and the display grid.
 *
 * Runs under [GraphicsMode.Mode.NATIVE] because the legacy Robolectric bitmap
 * shadow does not transform pixels for matrix-backed `Bitmap.createBitmap`,
 * so rotations would silently read back as blank.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], application = Application::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ImageTensorOrientationTest {

    private companion object {
        /** MiewID's model input size -- see onnxInferenceService. */
        const val MIEWID_INPUT = 440
    }

    @get:Rule
    val tmp = TemporaryFolder()

    // -------------------------------------------------------------------------
    // applyExifOrientation — EXIF/display coordinate-frame parity
    //
    // The detector normalizes boxes against whatever pixel grid loadBitmap
    // returns; React Native's <Image> and every EXIF-aware viewer show the
    // rotated grid. When those disagree, boxes are transposed on screen and
    // crops are cut from the wrong region. These tests pin both to one grid.
    // -------------------------------------------------------------------------

    /** Builds a bitmap from rows of colors so rotations are unambiguous. */
    private fun bitmapOf(rows: Array<IntArray>): Bitmap {
        val height = rows.size
        val width = rows[0].size
        val bmp = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        for (y in 0 until height) {
            for (x in 0 until width) {
                bmp.setPixel(x, y, rows[y][x])
            }
        }
        return bmp
    }

    private fun assertSamePixels(expected: Bitmap, actual: Bitmap) {
        assertEquals("width", expected.width, actual.width)
        assertEquals("height", expected.height, actual.height)
        for (y in 0 until expected.height) {
            for (x in 0 until expected.width) {
                assertEquals(
                    "pixel ($x,$y)",
                    expected.getPixel(x, y),
                    actual.getPixel(x, y),
                )
            }
        }
    }

    /** The photo as a viewer displays it: 4 wide, 2 tall, every cell distinct. */
    private fun uprightFixture(): Bitmap = bitmapOf(
        arrayOf(
            intArrayOf(Color.RED, Color.GREEN, Color.BLUE, Color.YELLOW),
            intArrayOf(Color.CYAN, Color.MAGENTA, Color.WHITE, Color.BLACK),
        ),
    )

    @Test
    fun `applyExifOrientation ROTATE_90 restores the upright grid`() {
        // What a sensor writes when the photo must be turned 90 degrees clockwise.
        val stored = bitmapOf(
            arrayOf(
                intArrayOf(Color.YELLOW, Color.BLACK),
                intArrayOf(Color.BLUE, Color.WHITE),
                intArrayOf(Color.GREEN, Color.MAGENTA),
                intArrayOf(Color.RED, Color.CYAN),
            ),
        )
        val upright = uprightFixture()

        val restored = ImageTensorModule.applyExifOrientation(
            stored,
            ExifInterface.ORIENTATION_ROTATE_90,
        )

        assertSamePixels(upright, restored)
    }

    @Test
    fun `applyExifOrientation ROTATE_180 restores the upright grid`() {
        val stored = bitmapOf(
            arrayOf(
                intArrayOf(Color.BLACK, Color.WHITE, Color.MAGENTA, Color.CYAN),
                intArrayOf(Color.YELLOW, Color.BLUE, Color.GREEN, Color.RED),
            ),
        )
        val upright = uprightFixture()

        val restored = ImageTensorModule.applyExifOrientation(
            stored,
            ExifInterface.ORIENTATION_ROTATE_180,
        )

        assertSamePixels(upright, restored)
    }

    @Test
    fun `applyExifOrientation ROTATE_270 restores the upright grid`() {
        val stored = bitmapOf(
            arrayOf(
                intArrayOf(Color.CYAN, Color.RED),
                intArrayOf(Color.MAGENTA, Color.GREEN),
                intArrayOf(Color.WHITE, Color.BLUE),
                intArrayOf(Color.BLACK, Color.YELLOW),
            ),
        )
        val upright = uprightFixture()

        val restored = ImageTensorModule.applyExifOrientation(
            stored,
            ExifInterface.ORIENTATION_ROTATE_270,
        )

        assertSamePixels(upright, restored)
    }

    @Test
    fun `applyExifOrientation NORMAL leaves an already-upright grid untouched`() {
        val upright = uprightFixture()

        val result = ImageTensorModule.applyExifOrientation(
            uprightFixture(),
            ExifInterface.ORIENTATION_NORMAL,
        )

        assertSamePixels(upright, result)
    }

    @Test
    fun `applyExifOrientation UNDEFINED leaves an already-upright grid untouched`() {
        val upright = uprightFixture()

        val result = ImageTensorModule.applyExifOrientation(
            uprightFixture(),
            ExifInterface.ORIENTATION_UNDEFINED,
        )

        assertSamePixels(upright, result)
    }

    @Test
    fun `applyExifOrientation FLIP_HORIZONTAL mirrors the stored grid`() {
        val stored = bitmapOf(
            arrayOf(
                intArrayOf(Color.YELLOW, Color.BLUE, Color.GREEN, Color.RED),
                intArrayOf(Color.BLACK, Color.WHITE, Color.MAGENTA, Color.CYAN),
            ),
        )
        val upright = uprightFixture()

        val restored = ImageTensorModule.applyExifOrientation(
            stored,
            ExifInterface.ORIENTATION_FLIP_HORIZONTAL,
        )

        assertSamePixels(upright, restored)
    }

    @Test
    fun `applyExifOrientation FLIP_VERTICAL mirrors the stored grid`() {
        val stored = bitmapOf(
            arrayOf(
                intArrayOf(Color.CYAN, Color.MAGENTA, Color.WHITE, Color.BLACK),
                intArrayOf(Color.RED, Color.GREEN, Color.BLUE, Color.YELLOW),
            ),
        )

        val restored = ImageTensorModule.applyExifOrientation(
            stored,
            ExifInterface.ORIENTATION_FLIP_VERTICAL,
        )

        assertSamePixels(uprightFixture(), restored)
    }

    @Test
    fun `applyExifOrientation TRANSPOSE restores the upright grid`() {
        val stored = bitmapOf(
            arrayOf(
                intArrayOf(Color.RED, Color.CYAN),
                intArrayOf(Color.GREEN, Color.MAGENTA),
                intArrayOf(Color.BLUE, Color.WHITE),
                intArrayOf(Color.YELLOW, Color.BLACK),
            ),
        )

        val restored = ImageTensorModule.applyExifOrientation(
            stored,
            ExifInterface.ORIENTATION_TRANSPOSE,
        )

        assertSamePixels(uprightFixture(), restored)
    }

    @Test
    fun `applyExifOrientation TRANSVERSE restores the upright grid`() {
        val stored = bitmapOf(
            arrayOf(
                intArrayOf(Color.BLACK, Color.YELLOW),
                intArrayOf(Color.WHITE, Color.BLUE),
                intArrayOf(Color.MAGENTA, Color.GREEN),
                intArrayOf(Color.CYAN, Color.RED),
            ),
        )

        val restored = ImageTensorModule.applyExifOrientation(
            stored,
            ExifInterface.ORIENTATION_TRANSVERSE,
        )

        assertSamePixels(uprightFixture(), restored)
    }

    // -------------------------------------------------------------------------
    // MiewID matchability guard
    //
    // MiewID embeds the cropped pixels. If the coordinate frame regresses, the
    // model sees a different picture for the same animal and match scores drop
    // silently — no crash, no failing screen. These assert byte-for-byte that
    // storage orientation cannot change what the model receives.
    // -------------------------------------------------------------------------

    @Test
    fun `MiewID tensor is identical whether the photo is stored upright or EXIF-rotated`() {
        val stored = bitmapOf(
            arrayOf(
                intArrayOf(Color.YELLOW, Color.BLACK),
                intArrayOf(Color.BLUE, Color.WHITE),
                intArrayOf(Color.GREEN, Color.MAGENTA),
                intArrayOf(Color.RED, Color.CYAN),
            ),
        )
        val fromExif = ImageTensorModule.applyExifOrientation(
            stored,
            ExifInterface.ORIENTATION_ROTATE_90,
        )

        val mean = doubleArrayOf(0.485, 0.456, 0.406)
        val std = doubleArrayOf(0.229, 0.224, 0.225)
        val expected = ImageTensorModule.bitmapToNchw(
            uprightFixture(), MIEWID_INPUT, MIEWID_INPUT, mean, std, 1.0 / 255.0, false,
        )
        val actual = ImageTensorModule.bitmapToNchw(
            fromExif, MIEWID_INPUT, MIEWID_INPUT, mean, std, 1.0 / 255.0, false,
        )

        assertEquals(expected.size, actual.size)
        for (i in expected.indices) {
            assertEquals("tensor element $i", expected[i], actual[i], 0.0)
        }
    }

    @Test
    fun `crop region is identical whether the photo is stored upright or EXIF-rotated`() {
        val stored = bitmapOf(
            arrayOf(
                intArrayOf(Color.YELLOW, Color.BLACK),
                intArrayOf(Color.BLUE, Color.WHITE),
                intArrayOf(Color.GREEN, Color.MAGENTA),
                intArrayOf(Color.RED, Color.CYAN),
            ),
        )
        val fromExif = ImageTensorModule.applyExifOrientation(
            stored,
            ExifInterface.ORIENTATION_ROTATE_90,
        )
        val upright = uprightFixture()

        // The right half of the animal, as the detector would report it.
        val expectedCrop = Bitmap.createBitmap(upright, 2, 0, 2, 2)
        val actualCrop = Bitmap.createBitmap(fromExif, 2, 0, 2, 2)

        assertSamePixels(expectedCrop, actualCrop)
    }

    // -------------------------------------------------------------------------
    // Call-site guard
    //
    // The tests above exercise applyExifOrientation directly, so they would all
    // still pass if someone removed the call from loadBitmap. This one goes
    // through the public cropImage bridge method with a real EXIF-tagged JPEG,
    // so it fails if the wiring is dropped.
    //
    // cropImage is used rather than imageToTensor because the latter resolves a
    // WritableNativeArray, which needs the React Native JNI that Robolectric
    // does not load.
    // -------------------------------------------------------------------------

    /** Writes an asymmetric JPEG and tags it with an EXIF orientation. */
    private fun writeTaggedJpeg(orientation: Int): File {
        val stored = bitmapOf(
            arrayOf(
                intArrayOf(Color.RED, Color.RED, Color.BLUE, Color.BLUE),
                intArrayOf(Color.RED, Color.RED, Color.BLUE, Color.BLUE),
            ),
        )
        val file = File(tmp.root, "tagged.jpg")
        FileOutputStream(file).use { out ->
            stored.compress(Bitmap.CompressFormat.JPEG, 100, out)
        }
        stored.recycle()
        val exif = ExifInterface(file.absolutePath)
        exif.setAttribute(ExifInterface.TAG_ORIENTATION, orientation.toString())
        exif.saveAttributes()
        return file
    }

    @Test
    fun `cropImage crops from the upright grid for an EXIF-rotated file`() {
        // Stored 4x2, red on the left. ORIENTATION_ROTATE_90 means it displays
        // as 2x4 with red on TOP, so the top half crop must be entirely red.
        val source = writeTaggedJpeg(ExifInterface.ORIENTATION_ROTATE_90)
        val outPath = File(tmp.root, "crop.jpg").absolutePath

        val module = ImageTensorModule(mock<ReactApplicationContext>())
        val latch = CountDownLatch(1)
        val failure = arrayOfNulls<String>(1)
        val promise = mock<Promise>()
        whenever(promise.resolve(any())) doAnswer { latch.countDown(); null }
        whenever(promise.reject(any<String>(), any<String>())) doAnswer { invocation ->
            failure[0] = invocation.getArgument<String>(1)
            latch.countDown()
            null
        }

        module.cropImage(source.absolutePath, 0.0, 0.0, 1.0, 0.5, outPath, promise)

        assertTrue("cropImage did not finish", latch.await(10, TimeUnit.SECONDS))
        assertEquals(null, failure[0])

        val crop = BitmapFactory.decodeFile(outPath)
        assertTrue("no output written", crop != null)

        // Upright is 2 wide by 4 tall; the top half is 2x2.
        assertEquals("crop width", 2, crop.width)
        assertEquals("crop height", 2, crop.height)

        // Every pixel red, allowing for JPEG loss. Without the orientation fix
        // this crop is a 4x1 strip that is half blue.
        for (y in 0 until crop.height) {
            for (x in 0 until crop.width) {
                val pixel = crop.getPixel(x, y)
                assertTrue(
                    "pixel ($x,$y) should be red, was ${Integer.toHexString(pixel)}",
                    Color.red(pixel) > 150 && Color.blue(pixel) < 100,
                )
            }
        }
        crop.recycle()
    }
}
