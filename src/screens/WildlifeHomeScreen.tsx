import React, { useMemo } from 'react';
import { View, Text, ScrollView, Image, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/Feather';
import { Card, AnimatedListItem } from '../components';
import { useThemedStyles } from '../theme/useThemedStyles';
import { useTheme } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';
import { useWildlifeStore } from '../stores/wildlifeStore';
import type { Observation } from '../types/wildlife';
import type { RootStackParamList } from '../navigation/types';
import { toDisplayUri } from '../utils/imageUri';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

function formatTimestamp(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const WildlifeHomeScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const { packs, observations, syncQueue } = useWildlifeStore();

  const totalIndividuals = useMemo(
    () => packs.reduce((sum, p) => sum + p.individualCount, 0),
    [packs],
  );

  const recentObservations = useMemo(
    () =>
      [...observations]
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        )
        .slice(0, 3),
    [observations],
  );

  const syncCounts = useMemo(() => {
    let pending = 0;
    let synced = 0;
    let failed = 0;
    for (const item of syncQueue) {
      if (item.status === 'pending' || item.status === 'uploading') {
        pending++;
      } else if (item.status === 'synced') {
        synced++;
      } else if (
        item.status === 'failed' ||
        item.status === 'failedPermanent'
      ) {
        failed++;
      }
    }
    return { pending, synced, failed };
  }, [syncQueue]);

  const handleCapture = () => {
    navigation.navigate('Capture');
  };

  const handleObservationPress = (observation: Observation) => {
    navigation.navigate('ObservationDetail', {
      observationId: observation.id,
    });
  };

  return (
    <SafeAreaView
      style={styles.container}
      testID="wildlife-home-screen"
      edges={['top']}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>EleBook</Text>
        <TouchableOpacity
          style={styles.settingsButton}
          onPress={() => navigation.navigate('Settings')}
          testID="home-settings-button"
        >
          <Icon name="settings" size={22} color={colors.text} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Quick Capture Button */}
        <TouchableOpacity
          style={styles.captureButton}
          onPress={handleCapture}
          activeOpacity={0.8}
          testID="capture-button"
        >
          <Icon name="camera" size={24} color={colors.background} />
          <Text style={styles.captureButtonText}>New Capture</Text>
        </TouchableOpacity>

        {/* Active Packs Summary */}
        <Card title="Active Packs" testID="packs-summary">
          {packs.length === 0 ? (
            <Text style={styles.emptyText}>No packs loaded</Text>
          ) : (
            <View style={styles.packStats}>
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{packs.length}</Text>
                <Text style={styles.statLabel}>
                  {packs.length === 1 ? 'pack' : 'packs'}
                </Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{totalIndividuals}</Text>
                <Text style={styles.statLabel}>individuals</Text>
              </View>
            </View>
          )}
        </Card>

        {/* Recent Observations */}
        <Card title="Recent Observations" testID="recent-observations">
          {recentObservations.length === 0 ? (
            <Text style={styles.emptyText}>No observations yet</Text>
          ) : (
            <View>
              {recentObservations.map((obs, index) => (
                <AnimatedListItem
                  key={obs.id}
                  index={index}
                  onPress={() => handleObservationPress(obs)}
                  testID={`observation-item-${index}`}
                >
                  <View style={styles.observationRow}>
                    <Image
                      source={{ uri: toDisplayUri(obs.photoUri) }}
                      style={styles.thumbnail}
                      testID={`observation-thumbnail-${index}`}
                    />
                    <View style={styles.observationInfo}>
                      <Text style={styles.observationTime}>
                        {formatTimestamp(obs.createdAt)}
                      </Text>
                      <Text style={styles.observationMeta}>
                        {obs.detections.length}{' '}
                        {obs.detections.length === 1
                          ? 'detection'
                          : 'detections'}
                      </Text>
                    </View>
                    <Icon
                      name="chevron-right"
                      size={16}
                      color={colors.textMuted}
                    />
                  </View>
                </AnimatedListItem>
              ))}
            </View>
          )}
        </Card>

        {/* Sync Status */}
        <Card title="Sync Status" testID="sync-status">
          <View style={styles.syncRow}>
            <View style={styles.syncItem}>
              <Text style={styles.syncValue}>{syncCounts.pending}</Text>
              <Text style={styles.syncLabel}>pending</Text>
            </View>
            <View style={styles.syncItem}>
              <Text style={styles.syncValue}>{syncCounts.synced}</Text>
              <Text style={styles.syncLabel}>synced</Text>
            </View>
            <View style={styles.syncItem}>
              <Text
                style={[
                  styles.syncValue,
                  syncCounts.failed > 0 && { color: colors.error },
                ]}
              >
                {syncCounts.failed}
              </Text>
              <Text style={styles.syncLabel}>failed</Text>
            </View>
          </View>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
};

const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
    ...shadows.small,
    zIndex: 1,
  },
  settingsButton: {
    padding: SPACING.xs,
  },
  title: {
    ...TYPOGRAPHY.h1,
    color: colors.text,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: SPACING.lg,
    gap: SPACING.lg,
  },
  captureButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: SPACING.md,
    gap: SPACING.sm,
    ...shadows.medium,
  },
  captureButtonText: {
    ...TYPOGRAPHY.h2,
    color: colors.background,
    fontWeight: '600' as const,
  },
  packStats: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  statItem: {
    alignItems: 'center' as const,
    paddingHorizontal: SPACING.xl,
  },
  statValue: {
    ...TYPOGRAPHY.display,
    color: colors.text,
  },
  statLabel: {
    ...TYPOGRAPHY.label,
    color: colors.textSecondary,
    marginTop: SPACING.xs,
  },
  statDivider: {
    width: 1,
    height: 32,
    backgroundColor: colors.border,
  },
  emptyText: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textMuted,
  },
  observationRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingVertical: SPACING.sm,
  },
  thumbnail: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: colors.surfaceLight,
  },
  observationInfo: {
    flex: 1,
    marginLeft: SPACING.md,
  },
  observationTime: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.text,
  },
  observationMeta: {
    ...TYPOGRAPHY.meta,
    color: colors.textSecondary,
    marginTop: 2,
  },
  syncRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-around' as const,
  },
  syncItem: {
    alignItems: 'center' as const,
  },
  syncValue: {
    ...TYPOGRAPHY.display,
    color: colors.text,
  },
  syncLabel: {
    ...TYPOGRAPHY.label,
    color: colors.textSecondary,
    marginTop: SPACING.xs,
  },
});
