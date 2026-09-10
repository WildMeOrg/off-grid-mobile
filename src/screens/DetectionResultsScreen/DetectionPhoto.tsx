import React, { useState } from 'react';
import { FlatList, Image, Text, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import type { Detection } from '../../types/wildlife';
import { useThemedStyles, useTheme } from '../../theme';
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
  const { colors } = useTheme();
  const [layout, setLayout] = useState<ImageSize | null>(null);
  const [image, setImage] = useState<{
    attempt: number;
    size: ImageSize | null;
    failed: boolean;
  }>({ attempt: 0, size: null, failed: false });
  const { attempt } = image;
  const frame = containedFrame(layout, image.size);

  return (
    <>
      {photoUri ? (
        <Image
          key={attempt}
          source={{ uri: toDisplayUri(photoUri) }}
          style={styles.photo}
          resizeMode="contain"
          testID="observation-photo"
          onLayout={({ nativeEvent }) => setLayout(nativeEvent.layout)}
          onLoad={({ nativeEvent }) => {
            const { width, height } = nativeEvent.source;
            const valid = [width, height].every(value => Number.isFinite(value) && value > 0);
            setImage(previous => previous.attempt === attempt
              ? { ...previous, size: valid ? { width, height } : null, failed: !valid }
              : previous);
          }}
          onError={() => setImage(previous => previous.attempt === attempt
            ? { ...previous, size: null, failed: true }
            : previous)}
        />
      ) : null}
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
      {!frame && (
        <View style={styles.photoFallback}>
          <Text style={styles.photoStatus} accessibilityRole={image.failed || !photoUri ? 'alert' : undefined}>
            {image.failed || !photoUri ? 'Photo unavailable' : 'Loading photo'}
          </Text>
          {photoUri && image.failed ? (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Retry photo"
              style={styles.photoRetry}
              onPress={() => setImage(previous => ({
                attempt: previous.attempt + 1, size: null, failed: false,
              }))}
            >
              <Icon name="refresh-cw" size={20} color={colors.primary} />
              <Text style={styles.photoActionText}>Retry photo</Text>
            </TouchableOpacity>
          ) : null}
          <FlatList
            data={detections}
            keyExtractor={detection => detection.id}
            style={styles.photoReviewList}
            renderItem={({ item, index }) => (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={`Review detection ${index + 1}`}
                style={styles.photoReviewRow}
                onPress={() => onBoxPress(item.id)}
              >
                <Text style={styles.photoReviewText} numberOfLines={2}>
                  {`Review detection ${index + 1}: ${item.species}`}
                </Text>
                <Icon name="chevron-right" size={20} color={colors.text} />
              </TouchableOpacity>
            )}
          />
        </View>
      )}
    </>
  );
};
