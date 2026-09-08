import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/Feather';
import { useThemedStyles } from '../theme/useThemedStyles';
import { useTheme } from '../theme';
import { useWildlifeStore } from '../stores/wildlifeStore';
import type { Observation, SyncQueueItem } from '../types/wildlife';
import type { RootStackParamList } from '../navigation/types';
import { syncAllObservations, syncObservation } from '../services/syncEngine';
import { ensureSignedIn } from '../utils/authGate';
import { useIndividualNameResolver } from '../hooks/useIndividualNameResolver';
import { createStyles } from './SyncScreen.styles';
import { SyncQueueRow } from './SyncQueueRow';
import logger from '../utils/logger';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const SyncScreen: React.FC = () => {
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const navigation = useNavigation<NavigationProp>();
  const syncQueue = useWildlifeStore((s) => s.syncQueue);
  const observations = useWildlifeStore((s) => s.observations);
  const packs = useWildlifeStore((s) => s.packs);
  const localIndividuals = useWildlifeStore((s) => s.localIndividuals);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncingObservationId, setSyncingObservationId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const allCandidates = useMemo(
    () =>
      syncQueue.flatMap((item) => {
        const observation = observations.find((obs) => obs.id === item.observationId);
        return observation ? observation.detections.flatMap((d) => d.matchResult.topCandidates) : [];
      }),
    [syncQueue, observations],
  );
  const resolveName = useIndividualNameResolver(allCandidates, packs, localIndividuals);

  const toggleExpanded = useCallback((observationId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(observationId)) {
        next.delete(observationId);
      } else {
        next.add(observationId);
      }
      return next;
    });
  }, []);

  const handleSyncAll = useCallback(async () => {
    if (isSyncing) {
      return;
    }
    if (!(await ensureSignedIn(navigation))) {
      return;
    }
    setIsSyncing(true);
    try {
      const result = await syncAllObservations();
      const parts: string[] = [];
      if (result.synced > 0) parts.push(`${result.synced} up to date (${result.uploaded} uploaded)`);
      if (result.waitingForReview > 0) parts.push(`${result.waitingForReview} waiting on review`);
      if (result.failed > 0) parts.push(`${result.failed} failed`);
      Alert.alert('Upload', parts.length > 0 ? parts.join(', ') : 'Nothing to upload');
    } catch (error) {
      logger.error('[SyncScreen] Upload All failed unexpectedly:', error);
      Alert.alert('Upload', 'Upload failed unexpectedly -- check the logs and try again.');
    } finally {
      setIsSyncing(false);
    }
  }, [isSyncing, navigation]);

  const handleUploadOrRetry = useCallback(
    async (item: SyncQueueItem) => {
      if (isSyncing || syncingObservationId) {
        return;
      }
      if (!(await ensureSignedIn(navigation))) {
        return;
      }
      const observation = observations.find((obs) => obs.id === item.observationId);
      if (!observation) {
        logger.warn(`[SyncScreen] Upload requested for unknown observation ${item.observationId}`);
        return;
      }
      setSyncingObservationId(item.observationId);
      try {
        const outcome = await syncObservation(observation);
        if (outcome.status === 'failed') {
          Alert.alert('Upload failed', outcome.message);
        }
      } catch (error) {
        logger.error(`[SyncScreen] Upload failed unexpectedly for ${item.observationId}:`, error);
        Alert.alert('Upload failed', 'An unexpected error occurred -- check the logs and try again.');
      } finally {
        setSyncingObservationId(null);
      }
    },
    [isSyncing, syncingObservationId, observations, navigation],
  );

  const handleContinueReview = useCallback(
    (observation: Observation) => {
      const nextPending = observation.detections.find(
        (d) => d.matchResult.reviewStatus === 'pending',
      );
      if (!nextPending) {
        return;
      }
      navigation.navigate('MatchReview', {
        observationId: observation.id,
        detectionId: nextPending.id,
      });
    },
    [navigation],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: SyncQueueItem; index: number }) => (
      <SyncQueueRow
        item={item}
        index={index}
        observation={observations.find((obs) => obs.id === item.observationId)}
        resolveName={resolveName}
        isRetrying={syncingObservationId === item.observationId}
        isSyncing={isSyncing}
        isExpanded={expandedIds.has(item.observationId)}
        colors={colors}
        styles={styles}
        onToggleExpanded={toggleExpanded}
        onContinueReview={handleContinueReview}
        onUploadOrRetry={handleUploadOrRetry}
      />
    ),
    [
      styles,
      colors,
      observations,
      resolveName,
      syncingObservationId,
      isSyncing,
      expandedIds,
      toggleExpanded,
      handleContinueReview,
      handleUploadOrRetry,
    ],
  );

  return (
    <SafeAreaView style={styles.container} testID="sync-screen" edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Upload Queue</Text>
      </View>

      <TouchableOpacity
        style={styles.syncAllButton}
        onPress={handleSyncAll}
        disabled={isSyncing}
        testID="sync-all-button"
      >
        {isSyncing ? (
          <ActivityIndicator size="small" color={styles.syncAllText.color} />
        ) : (
          <Icon name="upload-cloud" size={16} color={styles.syncAllText.color} />
        )}
        <Text style={styles.syncAllText}>{isSyncing ? 'Uploading...' : 'Upload All'}</Text>
      </TouchableOpacity>


      {syncQueue.length === 0 ? (
        <View style={styles.emptyState}>
          <Icon name="inbox" size={48} color={styles.emptyTitle.color} />
          <Text style={styles.emptyTitle}>No observations to upload</Text>
        </View>
      ) : (
        <FlatList
          data={syncQueue}
          renderItem={renderItem}
          keyExtractor={(item) => item.observationId}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
};
