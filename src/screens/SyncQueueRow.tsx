import React from 'react';
import { View, Text, Image, TouchableOpacity, ActivityIndicator } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { Card } from '../components';
import type { ThemeColors } from '../theme';
import type { Observation, SyncQueueItem } from '../types/wildlife';
import { toDisplayUri } from '../utils/imageUri';
import { getObservationStatusPresentation } from '../services/observationStatus';
import { getObservationStatusColor } from '../utils/observationStatusColors';
import type { createStyles } from './SyncScreen.styles';

/** Raw-status fallback copy for the rare case a queue row has no matching
 * observation (e.g. the observation record was deleted independently of its
 * sync_queue row) -- there is no Observation to derive the shared 7-state
 * presentation from, so this degrades to the underlying SyncStatus only. */
const ORPHANED_STATUS_LABEL: Record<SyncQueueItem['status'], string> = {
  pending: 'Pending',
  uploading: 'Uploading',
  synced: 'Synced',
  failed: 'Failed',
  failedPermanent: 'Failed',
};

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

function buildIdentitySummary(
  observation: Observation,
  resolveName: (individualId: string | null) => string | null,
): string {
  const detectionCountText =
    observation.detections.length === 1
      ? '1 detection'
      : `${observation.detections.length} detections`;

  const approvedIds = observation.detections
    .map((d) => d.matchResult.approvedIndividual)
    .filter((id): id is string => id !== null);

  if (approvedIds.length === 0) {
    return `${detectionCountText} \u00b7 not yet identified`;
  }

  const uniqueNames = Array.from(new Set(approvedIds.map((id) => resolveName(id) ?? id)));
  const namesText =
    uniqueNames.length <= 2
      ? uniqueNames.join(', ')
      : `${uniqueNames.slice(0, 2).join(', ')} +${uniqueNames.length - 2} more`;

  return `${namesText} \u00b7 ${detectionCountText}`;
}

function getNotesPreview(fieldNotes: string | null, maxLength = 80): string | null {
  if (!fieldNotes) {
    return null;
  }
  const trimmed = fieldNotes.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}...` : trimmed;
}

function truncateId(id: string, maxLength = 12): string {
  if (id.length <= maxLength) {
    return id;
  }
  return `${id.slice(0, maxLength)}...`;
}

interface SyncQueueRowProps {
  item: SyncQueueItem;
  index: number;
  observation: Observation | undefined;
  resolveName: (individualId: string | null) => string | null;
  isRetrying: boolean;
  isSyncing: boolean;
  isExpanded: boolean;
  colors: ThemeColors;
  styles: ReturnType<typeof createStyles>;
  onToggleExpanded: (observationId: string) => void;
  onContinueReview: (observation: Observation) => void;
  onUploadOrRetry: (item: SyncQueueItem) => void;
}

export const SyncQueueRow: React.FC<SyncQueueRowProps> = ({
  item,
  index,
  observation,
  resolveName,
  isRetrying,
  isSyncing,
  isExpanded,
  colors,
  styles,
  onToggleExpanded,
  onContinueReview,
  onUploadOrRetry,
}) => {
  // Degraded fallback: no matching observation to derive the shared status
  // from (see ORPHANED_STATUS_LABEL doc comment above).
  if (!observation) {
    return (
      <Card style={styles.itemCard} testID={`sync-item-${index}`}>
        <Text style={styles.observationId} testID={`sync-item-id-${index}`}>
          {truncateId(item.observationId)}
        </Text>
        <Text style={styles.statusText} testID={`sync-status-${item.status}`}>
          {ORPHANED_STATUS_LABEL[item.status]}
        </Text>
        {item.lastError && (
          <Text style={styles.errorText} testID={`sync-error-${index}`}>
            {item.lastError}
          </Text>
        )}
      </Card>
    );
  }

  const presentation = getObservationStatusPresentation(observation, item);
  const statusColor = getObservationStatusColor(colors, presentation.severity);
  const identitySummary = buildIdentitySummary(observation, resolveName);
  const notesPreview = getNotesPreview(observation.fieldNotes);

  const showAction =
    presentation.status === 'needs-review' ||
    presentation.status === 'ready-to-upload' ||
    presentation.status === 'upload-failed' ||
    presentation.status === 'needs-attention';

  const handleActionPress = () => {
    if (presentation.status === 'needs-review') {
      onContinueReview(observation);
    } else {
      onUploadOrRetry(item);
    }
  };

  return (
    <Card style={styles.itemCard} testID={`sync-item-${index}`}>
      <View style={styles.itemRow}>
        <Image
          source={{ uri: toDisplayUri(observation.photoUri) }}
          style={styles.thumbnail}
          testID={`sync-thumbnail-${index}`}
        />
        <View style={styles.itemContent}>
          <Text style={styles.timestamp}>{formatTimestamp(observation.timestamp)}</Text>
          <Text style={styles.identitySummary} testID={`sync-identity-${index}`}>
            {identitySummary}
          </Text>
          {notesPreview && (
            <Text style={styles.notesPreview} testID={`sync-notes-${index}`}>
              {notesPreview}
            </Text>
          )}
          <View style={styles.statusRow}>
            <View
              style={[styles.statusBadge, { backgroundColor: statusColor }]}
              testID={`sync-status-${presentation.status}`}
            />
            <Text style={[styles.statusText, { color: statusColor }]}>{presentation.label}</Text>
          </View>
          {presentation.status === 'received-by-elebook' && (
            <Text style={styles.statusMeta} testID={`sync-receipt-${index}`}>
              {presentation.submissionSummary}
              {presentation.receiptTime ? ` on ${formatTimestamp(presentation.receiptTime)}` : ''}
            </Text>
          )}
          {item.lastError && (
            <Text style={styles.errorText} testID={`sync-error-${index}`}>
              {item.lastError}
            </Text>
          )}
        </View>
      </View>

      <View style={styles.itemFooter}>
        <TouchableOpacity
          onPress={() => onToggleExpanded(item.observationId)}
          testID={`sync-technical-toggle-${index}`}
        >
          <Text style={styles.technicalToggleText}>
            {isExpanded ? 'Hide technical details' : 'Technical details'}
          </Text>
        </TouchableOpacity>
        {showAction && (
          <TouchableOpacity
            style={styles.actionButton}
            onPress={handleActionPress}
            disabled={isRetrying || isSyncing}
            testID={`sync-action-${index}`}
          >
            {isRetrying ? (
              <ActivityIndicator size="small" color={styles.actionButtonText.color} />
            ) : (
              <>
                <Icon name="upload-cloud" size={14} color={styles.actionButtonText.color} />
                <Text style={styles.actionButtonText}>{presentation.action}</Text>
              </>
            )}
          </TouchableOpacity>
        )}
      </View>

      {isExpanded && (
        <Text style={styles.observationId} testID={`sync-item-id-${index}`}>
          {item.observationId}
        </Text>
      )}
    </Card>
  );
};
