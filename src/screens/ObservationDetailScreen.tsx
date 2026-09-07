import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { Card } from '../components';
import { useTheme, useThemedStyles } from '../theme';
import { useWildlifeStore } from '../stores/wildlifeStore';
import type { RootStackParamList } from '../navigation/types';
import type { Detection, MatchCandidate, Observation } from '../types';
import { toDisplayUri } from '../utils/imageUri';
import { ensureSignedIn } from '../utils/authGate';
import { syncObservation } from '../services/syncEngine';
import { getObservationStatusPresentation } from '../services/observationStatus';
import { getObservationStatusColor } from '../utils/observationStatusColors';
import { useIndividualNameResolver } from '../hooks/useIndividualNameResolver';
import { createStyles } from './ObservationDetailScreen.styles';
import logger from '../utils/logger';

type NavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  'ObservationDetail'
>;
type ObservationDetailRouteProp = RouteProp<
  RootStackParamList,
  'ObservationDetail'
>;

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

/**
 * Rounds coordinates for display only; stored and uploaded GPS is unchanged.
 * The displayed location can still be sensitive and is not anonymized.
 */
function formatSafeLocation(gps: Observation['gps']): string {
  if (!gps) {
    return 'No location recorded';
  }
  return `~${gps.lat.toFixed(2)}, ${gps.lon.toFixed(2)} (\u00b1${Math.round(gps.accuracy)}m)`;
}

/**
 * `reviewStatus: 'rejected'` exists in the type but no current UI action
 * produces it (see src/services/observationStatus/index.ts) -- handled here
 * defensively so this screen stays correct if that action is added later.
 */
function getDetectionDecisionText(
  detection: Detection,
  resolvedName: string | null,
): string {
  if (detection.matchResult.reviewStatus === 'pending') {
    return 'Not yet reviewed';
  }
  if (detection.matchResult.reviewStatus === 'rejected') {
    return 'No usable identification';
  }
  return resolvedName ?? 'Unknown individual';
}

export const ObservationDetailScreen: React.FC = () => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<ObservationDetailRouteProp>();
  const { observationId } = route.params;
  const [isSyncing, setIsSyncing] = useState(false);

  const observation = useWildlifeStore((s) =>
    s.observations.find((o) => o.id === observationId),
  );
  const syncItem = useWildlifeStore((s) =>
    s.syncQueue.find((i) => i.observationId === observationId),
  );
  const packs = useWildlifeStore((s) => s.packs);
  const localIndividuals = useWildlifeStore((s) => s.localIndividuals);

  const allCandidates = useMemo<MatchCandidate[]>(
    () => (observation?.detections ?? []).flatMap((d) => d.matchResult.topCandidates),
    [observation],
  );
  const resolveName = useIndividualNameResolver(allCandidates, packs, localIndividuals);

  const presentation = useMemo(
    () => (observation ? getObservationStatusPresentation(observation, syncItem) : null),
    [observation, syncItem],
  );

  const handleBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  const handleContinueReview = useCallback(() => {
    if (!observation) {
      return;
    }
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
  }, [navigation, observation]);

  const handleUploadOrRetry = useCallback(async () => {
    if (!observation || isSyncing) {
      return;
    }
    if (!(await ensureSignedIn(navigation))) {
      return;
    }
    setIsSyncing(true);
    try {
      const outcome = await syncObservation(observation);
      if (outcome.status === 'failed') {
        Alert.alert('Upload failed', outcome.message);
      }
    } catch (error) {
      logger.error(
        `[ObservationDetail] Upload failed unexpectedly for ${observation.id}:`,
        error,
      );
      Alert.alert(
        'Upload failed',
        'An unexpected error occurred -- check the logs and try again.',
      );
    } finally {
      setIsSyncing(false);
    }
  }, [observation, isSyncing, navigation]);

  const primaryAction = useMemo(() => {
    if (!presentation) {
      return null;
    }
    switch (presentation.status) {
      case 'needs-review':
        return { label: presentation.action, onPress: handleContinueReview, loading: false };
      case 'ready-to-upload':
      case 'upload-failed':
      case 'needs-attention':
        return { label: presentation.action, onPress: handleUploadOrRetry, loading: isSyncing };
      case 'uploading':
        return { label: presentation.action, onPress: () => {}, loading: true };
      default:
        // 'received-by-elebook' and 'complete-locally' are informational only.
        return null;
    }
  }, [presentation, handleContinueReview, handleUploadOrRetry, isSyncing]);

  if (!observation || !presentation) {
    return (
      <SafeAreaView
        style={styles.container}
        testID="observation-detail-screen"
        edges={['top']}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={handleBack} style={styles.backButton} testID="back-button">
            <Icon name="arrow-left" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Observation Detail</Text>
          <View style={styles.backButton} />
        </View>
        <View style={styles.notFound}>
          <Text style={styles.notFoundText}>Observation not found.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const statusColor = getObservationStatusColor(colors, presentation.severity);

  return (
    <SafeAreaView
      style={styles.container}
      testID="observation-detail-screen"
      edges={['top']}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} style={styles.backButton} testID="back-button">
          <Icon name="arrow-left" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Observation Detail</Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView contentContainerStyle={styles.content} testID="observation-detail-scroll">
        <Image
          source={{ uri: toDisplayUri(observation.photoUri) }}
          style={styles.photo}
          resizeMode="cover"
          testID="observation-detail-photo"
        />

        <Card style={styles.section}>
          <Text style={styles.metaLabel}>Captured</Text>
          <Text style={styles.metaValue}>{formatTimestamp(observation.timestamp)}</Text>
          <Text style={[styles.metaLabel, styles.metaLabelSpaced]}>Location</Text>
          <Text style={styles.metaValue}>{formatSafeLocation(observation.gps)}</Text>
          {observation.fieldNotes ? (
            <>
              <Text style={[styles.metaLabel, styles.metaLabelSpaced]}>Notes</Text>
              <Text style={styles.metaValue} testID="observation-detail-notes">
                {observation.fieldNotes}
              </Text>
            </>
          ) : null}
        </Card>

        <Card style={styles.section} testID="observation-status-card">
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <Text style={[styles.statusLabel, { color: statusColor }]} testID="observation-status-label">
              {presentation.label}
            </Text>
          </View>
          <Text style={styles.statusDescription}>{presentation.description}</Text>
          {presentation.status === 'received-by-elebook' && (
            <Text style={styles.statusMeta} testID="observation-detail-receipt">
              {presentation.submissionSummary}
              {presentation.receiptTime ? ` on ${formatTimestamp(presentation.receiptTime)}` : ''}
            </Text>
          )}
          {(presentation.status === 'upload-failed' || presentation.status === 'needs-attention') &&
            syncItem?.lastError && (
              <Text style={styles.errorText} testID="observation-detail-error">
                {syncItem.lastError}
              </Text>
            )}

          {primaryAction && (
            <TouchableOpacity
              style={[styles.actionButton, primaryAction.loading && styles.actionButtonDisabled]}
              onPress={primaryAction.onPress}
              disabled={primaryAction.loading}
              testID="detail-action-button"
            >
              {primaryAction.loading ? (
                <ActivityIndicator color={colors.background} />
              ) : (
                <Text style={styles.actionButtonText}>{primaryAction.label}</Text>
              )}
            </TouchableOpacity>
          )}
        </Card>

        <Text style={styles.detectionsHeader}>
          {observation.detections.length === 1
            ? '1 Detection'
            : `${observation.detections.length} Detections`}
        </Text>

        {observation.detections.map((detection, index) => {
          const decisionName = resolveName(detection.matchResult.approvedIndividual);
          return (
            <Card key={detection.id} style={styles.section} testID={`detection-detail-${index}`}>
              <View style={styles.detectionRow}>
                <Image
                  source={{ uri: toDisplayUri(detection.croppedImageUri) }}
                  style={styles.detectionCrop}
                  testID={`detection-crop-${index}`}
                />
                <View style={styles.detectionInfo}>
                  <Text style={styles.metaValue}>{detection.species}</Text>
                  <Text style={styles.decisionText} testID={`detection-decision-${index}`}>
                    {getDetectionDecisionText(detection, decisionName)}
                  </Text>
                </View>
              </View>

              {detection.matchResult.topCandidates.length > 0 && (
                <View style={styles.candidatesBlock}>
                  <Text style={styles.metaLabel}>Candidate evidence</Text>
                  {detection.matchResult.topCandidates.map((candidate, rank) => {
                    const isApproved =
                      candidate.individualId === detection.matchResult.approvedIndividual;
                    const candidateName = resolveName(candidate.individualId) ?? candidate.individualId;
                    return (
                      <Text
                        key={candidate.individualId}
                        style={[styles.candidateText, isApproved && styles.candidateTextApproved]}
                        testID={`detection-${index}-candidate-${rank}`}
                      >
                        {`Candidate ${rank + 1}: ${candidateName}${isApproved ? ' (selected)' : ''}`}
                      </Text>
                    );
                  })}
                </View>
              )}
            </Card>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
};
