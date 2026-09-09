import React, { useState } from 'react';
import { Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../../theme';
import type { ThemeColors } from '../../theme';
import { SPACING } from '../../constants';
import { toDisplayUri } from '../../utils/imageUri';
import { createStyles as createBaseStyles } from './styles';

function boundedOffset(offset: number, extent: number, scale: number): number {
  'worklet';
  const limit = extent * (scale - 1) / 2;
  return Math.max(-limit, Math.min(limit, offset));
}

export function ZoomPhoto({ path }: { path: string }) {
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const dimensions = useWindowDimensions();
  const [size, setSize] = useState({ width: dimensions.width, height: dimensions.height });
  const [failed, setFailed] = useState(false);
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const offsetX = useSharedValue(0);
  const offsetY = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);

  const pinch = Gesture.Pinch().onStart(() => {
    savedScale.value = scale.value;
  }).onUpdate(event => {
    scale.value = Math.max(1, Math.min(5, savedScale.value * event.scale));
    offsetX.value = boundedOffset(offsetX.value, size.width, scale.value);
    offsetY.value = boundedOffset(offsetY.value, size.height, scale.value);
  });
  const pan = Gesture.Pan().averageTouches(true).onStart(() => {
    startX.value = offsetX.value;
    startY.value = offsetY.value;
  }).onUpdate(event => {
    offsetX.value = boundedOffset(startX.value + event.translationX, size.width, scale.value);
    offsetY.value = boundedOffset(startY.value + event.translationY, size.height, scale.value);
  });
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offsetX.value }, { translateY: offsetY.value }, { scale: scale.value }],
  }));
  const setZoom = (next: number) => {
    scale.value = Math.max(1, Math.min(5, next));
    savedScale.value = scale.value;
    offsetX.value = 0;
    offsetY.value = 0;
  };

  if (failed) return <View style={styles.empty}><Text style={styles.emptyText}>Image unavailable</Text></View>;
  return (
    <GestureHandlerRootView style={styles.container}>
      <View style={styles.viewport} onLayout={event => setSize(event.nativeEvent.layout)}>
        <GestureDetector gesture={Gesture.Simultaneous(pinch, pan)}>
          <Animated.View style={styles.imageSurface} collapsable={false}>
            <Animated.Image source={{ uri: toDisplayUri(path) }} style={[styles.fullImage, animatedStyle]}
              resizeMode="contain" onError={() => setFailed(true)} testID="inspected-image" accessibilityLabel="Individual photo" />
          </Animated.View>
        </GestureDetector>
      </View>
      <View style={styles.zoomToolbar}>
        <TouchableOpacity style={styles.iconButton} onPress={() => setZoom(scale.value - 1)} accessibilityRole="button" accessibilityLabel="Zoom out">
          <Icon name="zoom-out" size={24} color={colors.text} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.iconButton} onPress={() => setZoom(1)} accessibilityRole="button" accessibilityLabel="Fit image">
          <Icon name="maximize" size={24} color={colors.text} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.iconButton} onPress={() => setZoom(scale.value + 1)} accessibilityRole="button" accessibilityLabel="Zoom in">
          <Icon name="zoom-in" size={24} color={colors.text} />
        </TouchableOpacity>
      </View>
    </GestureHandlerRootView>
  );
}

const createStyles = (colors: ThemeColors) => ({
  ...createBaseStyles(colors),
  viewport: { flex: 1, overflow: 'hidden' as const, backgroundColor: colors.surface },
  imageSurface: { flex: 1 },
  fullImage: { width: '100%' as const, height: '100%' as const },
  zoomToolbar: { flexDirection: 'row' as const, justifyContent: 'center' as const, gap: SPACING.xl, padding: SPACING.sm },
});