import React, { useState } from 'react';
import { ActivityIndicator, Image, Text, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../../theme';
import { toDisplayUri } from '../../utils/imageUri';
import { usePhotoUri } from './hooks';
import type { BrowserPhoto } from './hooks';
import { createStyles } from './detail.styles';

export const photoLabel = (photo: BrowserPhoto): string => {
  if (photo.kind === 'reference') return 'Pack reference';
  return photo.kind === 'source' ? 'Local source photo' : 'Local detection crop';
};

export function PhotoTile({ photo, onPress }: { photo: BrowserPhoto; onPress: () => void }) {
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const { path, loading } = usePhotoUri(photo);
  const [failedPath, setFailedPath] = useState<string | null>(null);
  const available = Boolean(path && path !== failedPath);
  const label = photoLabel(photo);
  return (
    <TouchableOpacity style={styles.photoTile} onPress={onPress} disabled={!available}
      accessibilityRole="button" accessibilityLabel={`Inspect ${label}`} accessibilityState={{ disabled: !available }}
      testID={`photo-${photo.key}`}>
      <View style={[styles.imageFrame, styles.placeholder]}>
        {available ? <Image source={{ uri: toDisplayUri(path!) }} style={styles.image} resizeMode="contain"
          onError={() => setFailedPath(path)} testID={`image-${photo.key}`} /> : <>
          {loading ? <ActivityIndicator color={colors.primary} /> : <Icon name="image" size={24} color={colors.textMuted} />}
          <Text style={styles.emptyText}>{loading ? 'Loading image' : 'Image unavailable'}</Text>
        </>}
      </View>
      <Text style={styles.imageCaption}>{label}</Text>
    </TouchableOpacity>
  );
}