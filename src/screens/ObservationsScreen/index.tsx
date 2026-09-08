import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, Image, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/Feather';
import { AnimatedListItem } from '../../components';
import { Card } from '../../components';
import { useThemedStyles, useTheme } from '../../theme';
import { useWildlifeStore } from '../../stores/wildlifeStore';
import type { RootStackParamList } from '../../navigation/types';
import type { Observation, SyncQueueItem } from '../../types/wildlife';
import { toDisplayUri } from '../../utils/imageUri';
import { getObservationStatusPresentation } from '../../services/observationStatus';
import { getObservationStatusColor } from '../../utils/observationStatusColors';
import { createStyles } from './styles';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

type FilterKey = 'all' | 'pending' | 'reviewed' | 'synced';
type SortOrder = 'newest' | 'oldest';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'reviewed', label: 'Reviewed' },
  { key: 'synced', label: 'Synced' },
];

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getDetectionCountText(count: number): string {
  if (count === 1) {
    return '1 detection';
  }
  return `${count} detections`;
}

function isPendingReview(observation: Observation): boolean {
  return observation.detections.some(
    d => d.matchResult.reviewStatus === 'pending',
  );
}

function isAllReviewed(observation: Observation): boolean {
  return (
    observation.detections.length > 0 &&
    observation.detections.every(d => d.matchResult.reviewStatus !== 'pending')
  );
}

function isSynced(
  observation: Observation,
  syncQueue: SyncQueueItem[],
): boolean {
  const item = syncQueue.find(s => s.observationId === observation.id);
  return item?.status === 'synced';
}

function filterObservations(
  observations: Observation[],
  syncQueue: SyncQueueItem[],
  filter: FilterKey,
): Observation[] {
  switch (filter) {
    case 'pending':
      return observations.filter(isPendingReview);
    case 'reviewed':
      return observations.filter(isAllReviewed);
    case 'synced':
      return observations.filter(obs => isSynced(obs, syncQueue));
    default:
      return observations;
  }
}

/** Sorts by capture time -- the same field the row displays via formatTimestamp. */
function sortObservations(observations: Observation[], order: SortOrder): Observation[] {
  const direction = order === 'newest' ? -1 : 1;
  return [...observations].sort(
    (a, b) => direction * (new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()),
  );
}

export const ObservationsScreen: React.FC = () => {
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const navigation = useNavigation<NavigationProp>();
  const [activeFilter, setActiveFilter] = useState<FilterKey>('all');
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest');

  const observations = useWildlifeStore(s => s.observations);
  const syncQueue = useWildlifeStore(s => s.syncQueue);

  const filtered = useMemo(
    () => sortObservations(filterObservations(observations, syncQueue, activeFilter), sortOrder),
    [observations, syncQueue, activeFilter, sortOrder],
  );

  const toggleSortOrder = useCallback(() => {
    setSortOrder(order => (order === 'newest' ? 'oldest' : 'newest'));
  }, []);

  const handleObservationPress = useCallback(
    (observationId: string) => {
      navigation.navigate('ObservationDetail', { observationId });
    },
    [navigation],
  );

  const renderObservation = useCallback(
    ({ item, index }: { item: Observation; index: number }) => {
      const syncItem = syncQueue.find(s => s.observationId === item.id);
      const presentation = getObservationStatusPresentation(item, syncItem);
      const statusColor = getObservationStatusColor(colors, presentation.severity);

      return (
        <AnimatedListItem
          index={index}
          onPress={() => handleObservationPress(item.id)}
          testID={`observation-card-${index}`}
        >
          <Card>
            <View style={styles.row}>
              <Image
                source={{ uri: toDisplayUri(item.photoUri) }}
                style={styles.thumbnail}
                testID={`observation-thumbnail-${index}`}
              />
              <View style={styles.rowContent}>
                <Text style={styles.timestamp}>
                  {formatTimestamp(item.timestamp)}
                </Text>
                <Text style={styles.detectionCount}>
                  {getDetectionCountText(item.detections.length)}
                </Text>
                <View style={styles.statusRow}>
                  <View
                    style={[styles.statusDot, { backgroundColor: statusColor }]}
                    testID={`observation-status-dot-${index}`}
                  />
                  <Text
                    style={[styles.reviewStatus, { color: statusColor }]}
                    testID={`observation-status-label-${index}`}
                  >
                    {presentation.label}
                  </Text>
                </View>
              </View>
              <Icon
                name="chevron-right"
                size={18}
                color={styles.reviewStatus.color}
              />
            </View>
          </Card>
        </AnimatedListItem>
      );
    },
    [handleObservationPress, styles, syncQueue, colors],
  );

  const keyExtractor = useCallback((item: Observation) => item.id, []);

  return (
    <SafeAreaView
      style={styles.container}
      testID="observations-screen"
      edges={['top']}
    >
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Observations</Text>
          <TouchableOpacity
            style={styles.sortButton}
            onPress={toggleSortOrder}
            testID="sort-toggle-button"
          >
            <Icon
              name={sortOrder === 'newest' ? 'arrow-down' : 'arrow-up'}
              size={14}
              color={colors.textSecondary}
            />
            <Text style={styles.sortButtonText}>
              {sortOrder === 'newest' ? 'Newest first' : 'Oldest first'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.filterBar} testID="filter-bar">
        {FILTERS.map(f => (
          <TouchableOpacity
            key={f.key}
            style={[
              styles.filterChip,
              activeFilter === f.key && styles.filterChipActive,
            ]}
            onPress={() => setActiveFilter(f.key)}
            testID={`filter-${f.key}`}
          >
            <Text
              style={[
                styles.filterChipText,
                activeFilter === f.key && styles.filterChipTextActive,
              ]}
            >
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {filtered.length === 0 ? (
        <View style={styles.emptyState} testID="empty-state">
          <Text style={styles.emptyTitle}>No Observations</Text>
          <Text style={styles.emptyText}>
            Capture a photo to start recording wildlife observations.
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          renderItem={renderObservation}
          keyExtractor={keyExtractor}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          testID="observations-list"
        />
      )}
    </SafeAreaView>
  );
};
