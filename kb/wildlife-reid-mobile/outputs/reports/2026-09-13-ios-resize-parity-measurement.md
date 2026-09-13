# iOS preprocessing parity — measured before/after

**Date:** 2026-09-13
**Subject:** `ios/ImageTensorModule.swift` resize path vs `android/.../ImageTensorModule.kt` `progressiveResize`
**Method:** standalone Swift binary run under `xcrun simctl spawn` on an iPhone 17 Pro simulator, exercising the old and new resampling paths on identical in-memory fixtures. Not a device test and not a MiewID test.

## What was wrong

Android reduces toward the target in repeated 2x steps (`progressiveResize`, pinned by the E13-4 golden on-device parity test). iOS did a single `UIImage.draw(in:)` through a `UIGraphicsImageRenderer` built with the **default** format, whose `scale` is `UIScreen.main.scale`. Two consequences:

1. A 440x440 request allocated a 440·scale buffer — measured at **1320x1320 on a 3x device, 880x880 on a 2x device** — which `extractNchw` then resampled a second time down to 440.
2. Because the intermediate size came from the screen, **the tensor depended on which iPhone ran it**.

## Measurements

Detail-dense diagonal-texture fixture, reduced to 440x440. Values are absolute per-channel differences out of 255.

| Source | old@2x vs old@3x | new vs old@2x | new vs old@3x |
| --- | --- | --- | --- |
| 4032x3024 (12MP full frame) | max 2, mean 0.23 | max 7, mean 0.31 | max 5, mean 0.29 |
| 2048x1536 (large crop) | max 6, mean 0.48 | max 4, mean 0.41 | max 6, mean 0.43 |
| 1500x1200 (mid crop) | max 26, mean 1.69 | max 9, mean 1.63 | max 27, mean 2.17 |
| 880x700 (small crop) | max 49, mean 3.57 | max 33, mean 2.62 | max 41, mean 3.84 |

The first column is the device-dependence bug on its own: the same photo, the same build, two different iPhones, up to 49/255 apart on a channel. The new path removes it — output is a function of the image alone.

For a 1760x1760 source the old 3x path coincidentally matched the new chain at 2x exactly (max 0), because 1760 -> 880 -> 440 *is* the halving chain. The coincidence does not hold at other sizes, which is the point: the old behaviour was an accident of screen scale.

## What this does not establish

- **Not byte parity with Android.** The chain structure now matches, but the per-step filter does not: Android uses `Bitmap.createScaledBitmap(filter = true)` (bilinear), iOS uses `CGContext` at `.high` interpolation. Same algorithm, different kernel.
- **No MiewID impact measured.** Differences of a few units out of 255 may or may not reorder candidates. Establishing that needs the golden batch run on both platforms against the same images — the E13-4 equivalent for iOS, which does not exist yet.
- Synthetic high-frequency fixtures are a worst case. Real fur and skin will differ by less.

## Follow-up worth doing

An iOS counterpart to the E13-4 on-device parity test, comparing embeddings for a fixed image set against the Python reference, is the only thing that would turn "the algorithm matches" into "the results match".
