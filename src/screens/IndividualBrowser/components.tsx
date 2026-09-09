import React, { useState } from 'react';
import { ActivityIndicator, Image, Text, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../../theme';
import { Button } from '../../components';
import type { EmbeddingPack, PackIndividual } from '../../types';
import { individualName } from '../../services/individualBrowser/model';
import { toDisplayUri } from '../../utils/imageUri';
import { useReferencePhotos } from './hooks';
import type { BrowserStatus } from './hooks';
import { createStyles } from './styles';

export function BrowserHeader({ title, onBack }: { title: string; onBack?: () => void }) {
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  return (
    <View style={styles.header}>
      {onBack && <TouchableOpacity style={styles.iconButton} onPress={onBack} accessibilityRole="button" accessibilityLabel="Back" testID="browser-back">
        <Icon name="arrow-left" size={24} color={colors.text} />
      </TouchableOpacity>}
      <Text style={styles.title} accessibilityRole="header">{title}</Text>
    </View>
  );
}

export function BrowserState({ status, onRetry, missingText = 'Pack removed or unavailable' }: {
  status: BrowserStatus; onRetry: () => void; missingText?: string;
}) {
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const messages: Record<BrowserStatus, string> = {
    loading: 'Loading individuals', ready: '', missing: missingText,
    quarantined: 'Pack quarantined. Browsing is unavailable.',
    unvalidated: 'Pack validation pending', error: 'Pack index unavailable',
  };
  return (
    <View style={styles.empty} testID={`browser-${status}`}>
      {status === 'loading' && <ActivityIndicator color={colors.primary} />}
      <Text style={styles.emptyText}>{messages[status]}</Text>
      {status === 'error' && <Button title="Retry" onPress={onRetry} icon={<Icon name="refresh-cw" size={20} color={colors.primary} />} />}
    </View>
  );
}

export function IndividualRow({ pack, individual, onPress }: {
  pack: EmbeddingPack; individual: PackIndividual; onPress: () => void;
}) {
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const { photos, loading } = useReferencePhotos(pack, individual, 1);
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const uri = photos[0]?.uri;
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} accessibilityRole="button"
      accessibilityLabel={`${individualName(individual)}, ${individual.id}`} testID={`individual-row-${individual.id}`}>
      {uri && uri !== failedUri ? (
        <Image source={{ uri: toDisplayUri(uri) }} style={styles.thumbnail} onError={() => setFailedUri(uri)} />
      ) : (
        <View style={[styles.thumbnail, styles.placeholder]} accessibilityLabel={loading ? 'Loading image' : 'Image unavailable'}>
          <Icon name="image" size={24} color={colors.textMuted} />
        </View>
      )}
      <View style={styles.rowText}>
        <Text style={styles.name} numberOfLines={2}>{individualName(individual)}</Text>
        <Text style={styles.secondary} numberOfLines={2}>{individual.id}</Text>
      </View>
      <Icon name="chevron-right" size={20} color={colors.textMuted} />
    </TouchableOpacity>
  );
}