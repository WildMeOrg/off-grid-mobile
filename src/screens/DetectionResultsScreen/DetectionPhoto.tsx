import React, { useState } from 'react';
import { Image, View } from 'react-native';
import type { Detection } from '../../types/wildlife';
import { useThemedStyles } from '../../theme';
import { toDisplayUri } from '../../utils/imageUri';
import { BoundingBoxOverlay } from './BoundingBoxOverlay';
import { createStyles } from './styles';

interface ImageSize {
  width: number;
  height: number;
}

interface DetectionPhotoProps {
  photoUri: string;
  detections: Detection[];
  onBoxPress: (detectionId: string) => void;
  resolveName: (individualId: string | null) => string | null;
}

function containedFrame(layout: ImageSize | null, image: ImageSize | null) {
  if (!layout || !image || ![layout.width, layout.height, image.width, image.height]
    .every(value => Number.isFinite(value) && value > 0)) {
    return null;
  }
  const scale = Math.min(layout.width / image.width, layout.height / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  return {
    left: (layout.width - width) / 2,
    top: (layout.height - height) / 2,
    width,
    height,
  };
}

export const DetectionPhoto: React.FC<DetectionPhotoProps> = ({
  photoUri, detections, onBoxPress, resolveName,
}) => {
  const styles = useThemedStyles(createStyles);
  const [layout, setLayout] = useState<ImageSize | null>(null);
  const [imageSize, setImageSize] = useState<ImageSize | null>(null);
  const frame = containedFrame(layout, imageSize);

  return (
    <>
      <Image
        source={{ uri: toDisplayUri(photoUri) }}
        style={styles.photo}
        resizeMode="contain"
        testID="observation-photo"
        onLayout={({ nativeEvent }) => setLayout(nativeEvent.layout)}
        onLoad={({ nativeEvent }) => setImageSize({
          width: nativeEvent.source.width,
          height: nativeEvent.source.height,
        })}
        onError={() => setImageSize(null)}
      />
      {frame && (
        <View
          style={[styles.overlayContainer, frame]}
          testID="detection-overlay"
          pointerEvents="box-none"
        >
          {detections.map(detection => (
            <BoundingBoxOverlay
              key={detection.id}
              detection={detection}
              onPress={() => onBoxPress(detection.id)}
              resolveName={resolveName}
            />
          ))}
        </View>
      )}
    </>
  );
};