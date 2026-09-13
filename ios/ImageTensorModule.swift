import Foundation
import UIKit

@objc(ImageTensorModule)
class ImageTensorModule: NSObject {

  @objc
  static func requiresMainQueueSetup() -> Bool {
    return false
  }

  // MARK: - imageToTensor

  @objc
  // swiftlint:disable:next function_parameter_count
  func imageToTensor(
    _ uri: String,
    width: Double,
    height: Double,
    mean: [Double],
    std: [Double],
    scale: Double,
    channelOrder: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.global(qos: .userInitiated).async {
      guard let source = Self.loadUprightImage(from: uri) else {
        reject("IMAGE_ERROR", "Could not load image: \(uri)", nil)
        return
      }

      let targetW = Int(width)
      let targetH = Int(height)

      guard let resized = Self.progressiveResize(source, width: targetW, height: targetH) else {
        reject("IMAGE_ERROR", "Failed to resize image", nil)
        return
      }

      guard let output = Self.extractNchw(
        from: resized,
        width: targetW,
        height: targetH,
        mean: mean,
        std: std,
        scale: scale,
        bgr: channelOrder.uppercased() == "BGR"
      ) else {
        reject("IMAGE_ERROR", "Failed to extract pixel data", nil)
        return
      }

      resolve(output)
    }
  }

  // MARK: - cropImage

  @objc
  // swiftlint:disable:next function_parameter_count
  func cropImage(
    _ uri: String,
    x cropX: Double,
    y cropY: Double,
    width: Double,
    height: Double,
    outputPath: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.global(qos: .userInitiated).async {
      guard let cgImage = Self.loadUprightImage(from: uri) else {
        reject("IMAGE_ERROR", "Could not load image: \(uri)", nil)
        return
      }

      let imgW = Double(cgImage.width)
      let imgH = Double(cgImage.height)

      let pixelX = max(0, min(cropX * imgW, imgW - 1))
      let pixelY = max(0, min(cropY * imgH, imgH - 1))
      let pixelWidth = max(1, min(width * imgW, imgW - pixelX))
      let pixelHeight = max(1, min(height * imgH, imgH - pixelY))

      let cropRect = CGRect(x: pixelX, y: pixelY, width: pixelWidth, height: pixelHeight)

      guard let cropped = cgImage.cropping(to: cropRect) else {
        reject("IMAGE_ERROR", "Failed to crop image", nil)
        return
      }

      let croppedImage = UIImage(cgImage: cropped)
      guard let jpegData = croppedImage.jpegData(compressionQuality: 0.95) else {
        reject("IMAGE_ERROR", "Failed to encode cropped image as JPEG", nil)
        return
      }

      let outputURL = URL(fileURLWithPath: outputPath)
      let parentDir = outputURL.deletingLastPathComponent()

      do {
        try FileManager.default.createDirectory(
          at: parentDir,
          withIntermediateDirectories: true
        )
        try jpegData.write(to: outputURL)
        resolve(outputPath)
      } catch {
        reject("IMAGE_ERROR", "Failed to save cropped image: \(error.localizedDescription)", error)
      }
    }
  }

  // MARK: - Helpers (internal for testing)

  static func loadImage(from uri: String) -> UIImage? {
    // Strip file:// scheme
    var path = uri
    if path.hasPrefix("file://") {
      path = String(path.dropFirst(7))
    }

    // Try as file path first
    if FileManager.default.fileExists(atPath: path) {
      return UIImage(contentsOfFile: path)
    }

    // Try as URL
    if let url = URL(string: uri), let data = try? Data(contentsOf: url) {
      return UIImage(data: data)
    }

    return nil
  }

  /// Decode an image and return it on the upright display grid.
  ///
  /// Every consumer in this module -- the detector tensor and the saved crop --
  /// goes through here, so they cannot disagree about orientation. Mirrors
  /// `loadBitmap` in the Android module.
  static func loadUprightImage(from uri: String) -> CGImage? {
    guard let image = loadImage(from: uri) else {
      return nil
    }
    return uprightImage(image)?.cgImage
  }

  /// Redraw an image onto the upright grid described by its EXIF orientation.
  ///
  /// `UIImage.cgImage` is the raw stored buffer and ignores `imageOrientation`,
  /// while every EXIF-aware viewer applies it. Cropping or resampling the raw
  /// buffer therefore works from the wrong region for any rotated photo: the
  /// on-screen box looks right while the crop MiewID embeds is wrong.
  /// Normalising here puts the tensor and the crop on the same grid as the
  /// detector, the overlay, and every EXIF-aware viewer.
  ///
  /// Returns the input unchanged when it is already upright.
  static func uprightImage(_ image: UIImage) -> UIImage? {
    if image.imageOrientation == .up {
      return image
    }
    let format = UIGraphicsImageRendererFormat.default()
    format.scale = image.scale
    format.opaque = false
    let renderer = UIGraphicsImageRenderer(size: image.size, format: format)
    return renderer.image { _ in
      image.draw(in: CGRect(origin: .zero, size: image.size))
    }
  }

  /// Resize toward (targetWidth, targetHeight) via repeated 2x downscales
  /// before the final step, instead of one large single-shot resize.
  ///
  /// Resampling is only accurate for moderate size reductions. For a large
  /// reduction in one step (e.g. a multi-megapixel photo down to 440x440 --
  /// 10x or more per axis), high-frequency detail gets folded into different
  /// values instead of being averaged away, unlike PIL/torchvision's `Resize`
  /// (used by the Python reference pipeline), which applies antialiasing before
  /// subsampling. Repeated halving approximates that antialiasing with a
  /// box/mipmap-style filter chain, so no individual step exceeds 2x.
  ///
  /// This mirrors `progressiveResize` in the Android module, which was verified
  /// against Project Ganesha's golden on-device parity test (E13-4). The
  /// structure matches; the per-step filter still does not (Android resamples
  /// bilinearly via `createScaledBitmap`, this resamples at `.high`), so this
  /// buys a shared algorithm, not byte parity.
  ///
  /// What it definitely fixes is device dependence. The previous single-shot
  /// path resampled through `UIGraphicsImageRenderer`'s default format, whose
  /// scale is the screen scale, so the same photo yielded a different tensor on
  /// a 2x and a 3x iPhone -- measured up to 49/255 on a channel for a small
  /// crop. See kb/wildlife-reid-mobile/outputs/reports/2026-09-13-ios-resize-parity-measurement.md.
  static func progressiveResize(_ source: CGImage, width targetWidth: Int, height targetHeight: Int) -> CGImage? {
    guard targetWidth > 0, targetHeight > 0 else {
      return nil
    }
    if source.width == targetWidth && source.height == targetHeight {
      return source
    }

    var current = source
    while current.width > targetWidth * 2 && current.height > targetHeight * 2 {
      let nextWidth = max(targetWidth, current.width / 2)
      let nextHeight = max(targetHeight, current.height / 2)
      guard let next = redraw(current, width: nextWidth, height: nextHeight) else {
        return nil
      }
      current = next
    }

    return redraw(current, width: targetWidth, height: targetHeight)
  }

  /// Resample into an exactly `width` x `height` pixel buffer.
  ///
  /// Deliberately not `UIGraphicsImageRenderer`, whose default format uses the
  /// screen scale: on a 3x device that renders a 440x440 request into a
  /// 1320x1320 buffer, so the halving chain above would measure the wrong
  /// dimensions and `extractNchw` would resample the oversized result a second
  /// time. Sizing the context in pixels keeps the chain honest.
  private static func redraw(_ cgImage: CGImage, width: Int, height: Int) -> CGImage? {
    guard let colorSpace = CGColorSpace(name: CGColorSpace.sRGB),
          let context = CGContext(
            data: nil,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: 4 * width,
            space: colorSpace,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
          ) else {
      return nil
    }
    context.interpolationQuality = .high
    context.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))
    return context.makeImage()
  }

  static func extractNchw(
    from cgImage: CGImage,
    width imageWidth: Int,
    height imageHeight: Int,
    mean: [Double],
    std: [Double],
    scale: Double,
    bgr: Bool
  ) -> [Double]? {
    let bytesPerPixel = 4
    let bytesPerRow = bytesPerPixel * imageWidth
    let bitsPerComponent = 8

    var pixelData = [UInt8](repeating: 0, count: imageHeight * bytesPerRow)

    guard let colorSpace = CGColorSpace(name: CGColorSpace.sRGB),
          let context = CGContext(
            data: &pixelData,
            width: imageWidth,
            height: imageHeight,
            bitsPerComponent: bitsPerComponent,
            bytesPerRow: bytesPerRow,
            space: colorSpace,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
          ) else {
      return nil
    }

    context.draw(cgImage, in: CGRect(x: 0, y: 0, width: imageWidth, height: imageHeight))

    // RGBA byte layout → NCHW double array
    var output = [Double](repeating: 0.0, count: 3 * imageHeight * imageWidth)

    let rIdx = bgr ? 2 : 0
    let gIdx = 1
    let bIdx = bgr ? 0 : 2

    for row in 0..<imageHeight {
      for col in 0..<imageWidth {
        let pixelOffset = row * bytesPerRow + col * bytesPerPixel
        let red = Double(pixelData[pixelOffset])
        let green = Double(pixelData[pixelOffset + 1])
        let blue = Double(pixelData[pixelOffset + 2])

        let pixelIndex = row * imageWidth + col
        // `scale` is a multiplier per docs/EMBEDDING_PACK_FORMAT.md (e.g. 1/255 to move
        // uint8 [0,255] into float [0,1] before mean/std normalization).
        output[rIdx * imageHeight * imageWidth + pixelIndex] = (red * scale - mean[0]) / std[0]
        output[gIdx * imageHeight * imageWidth + pixelIndex] = (green * scale - mean[1]) / std[1]
        output[bIdx * imageHeight * imageWidth + pixelIndex] = (blue * scale - mean[2]) / std[2]
      }
    }

    return output
  }
}
