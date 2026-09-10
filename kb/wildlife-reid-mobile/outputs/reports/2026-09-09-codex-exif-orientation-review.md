# Codex review — EXIF orientation coordinate frame (PR #35)

**Date:** 2026-09-09
**Reviewer:** Codex 5.5 (`codex exec`, read-only sandbox)
**Subject:** `fix/exif-orientation-coordinate-frame` — Android `ImageTensorModule.kt`, iOS `ImageTensorModule.swift`, and their tests
**Verdict:** *"The orientation fix is correct and converged geometrically. The tests are not fully converged."* No Critical defect.

## Background

Detection boxes and MiewID crops were normalized against the raw sensor pixel
buffer, while the app displays the EXIF-rotated image. For any rotated photo
those are two different pictures.

- **Android:** `BitmapFactory` ignores the orientation tag; Fresco applies it
  (`setAutoRotateEnabled(true)`). Boxes were transposed on screen and crops cut
  from the wrong region.
- **iOS:** `imageToTensor` honoured orientation implicitly, because
  `resizeImage` uses `UIImage.draw(in:)`. `cropImage` used the raw `cgImage`.
  The overlay looked right while the crop fed to MiewID was wrong, degrading
  match scores with no visible symptom.

Discovered during the review of PR #34, which fixed a separate overlay-scaling
bug and is unrelated to this one.

## Findings and disposition

| # | Severity | Finding | Disposition |
|---|---|---|---|
| 1 | Major | iOS fixtures used the renderer's default screen scale while rewrapping the buffer at `scale: 1`, so a "4x2" image is 8x4 or 12x6 on a 2x/3x simulator and the dimension assertions fail despite correct production code. | **Fixed.** Both fixtures now render through a renderer pinned to scale 1. Found independently before reading the review. |
| 2 | Major | Every orientation test called `applyExifOrientation` / `uprightImage` directly, so removing the call from `loadBitmap` or `cropImage` would have left them all green. | **Fixed for Android.** Added an end-to-end test through the `cropImage` bridge method with a real EXIF-tagged JPEG. Verified by unwiring `loadBitmap`: exactly that test fails, then passes when restored. **Open for iOS** (see below). |
| 3 | Minor | Exceptional paths skip bitmap recycling: a transform failure leaks the decoded bitmap, a tensor failure leaks the caller's, a crop or file-write failure leaks both. Successful-path ownership is correct, with no double-recycle or use-after-recycle. | **Deferred.** GC reclaims these; deterministic release is a behaviour change that needs its own tests. Worth a follow-up. |
| 4 | Minor | Crop quantization still differs across platforms: Android truncates origin and extent independently, iOS passes fractional bounds to Core Graphics, which expands to integral bounds. For `x=1.5, width=2.5` Android selects `[1,3)` and iOS `[1,4)`. | **Deferred, pre-existing.** Not an EXIF error. Fix is a shared integer-bound calculation on both platforms. |
| 5 | Correct | All eight Android transforms and every stored fixture verified against an independently derived source-to-upright pixel mapping table, including the `FₓR90 = TRANSPOSE` and `FₓR270 = TRANSVERSE` post-multiplication order. | No action. |
| 6 | Correct | iOS `uprightImage` uses orientation-aware `image.size` and preserves `image.scale`. `UIImage(cgImage:)` at the end of `cropImage` correctly uses `.up` because orientation is already baked into those pixels. Both platforms now match the RN `<Image>` display frame. | No action. |
| 7 | Correct | `content://` decoding and EXIF parsing each open a fresh stream closed with `use`; attributes are read at construction, so reading orientation after closure is valid. Unknown values safely return the input. | No action. |

## Verification performed locally

Android, on WSL, all passing:

| Gate | Result |
|---|---|
| `compileDebugKotlin` | pass |
| `lintDebug` | pass, 2 warnings, none new |
| Android unit suite | 30 tests, 0 failures |
| Orientation suite | 12 tests, 0 failures |

Red-green was genuine: the nine pure-function tests were watched failing against
a no-op stub before implementation, and the call-site test was watched failing
against an unwired `loadBitmap`.

## Open gaps

- **The iOS tests have never been executed.** This host has no `xcodebuild` and
  no Swift toolchain, and the CI workflow has no iOS test job. They need a run
  on a Mac before merge.
- **No iOS call-site test.** Codex finding 2 is closed for Android only. The
  equivalent Swift test needs `CGImageDestination` with EXIF properties, which
  would be more unverifiable code on this host.
- **The Android `content://` path is untested.** Only the plain file path is
  covered; the gallery path needs an instrumented test.
- **CI has no iOS test job at all.** Worth adding independently of this change.

## Follow-ups worth filing

1. Add an iOS test job to the CI workflow, then run the Swift tests.
2. Deterministic bitmap release on exceptional paths (finding 3).
3. Shared integer crop-bound calculation across platforms (finding 4).
4. Downsample at decode. `applyExifOrientation` allocates a second
   full-resolution bitmap, doubling peak memory while both exist. This
   compounds an existing problem: capture already decodes at full resolution
   with no downsampling (`quality: 1`, no `maxWidth`/`maxHeight`).
5. Observations captured on Android before this fix still carry boxes in the
   old frame. They are not migrated, and nothing marks which convention
   produced them.
