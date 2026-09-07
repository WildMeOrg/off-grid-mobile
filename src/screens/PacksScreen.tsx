import React, { useCallback, useRef, useState } from 'react';
import { View, Text, FlatList, Alert, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AnimatedListItem } from '../components/AnimatedListItem';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { useThemedStyles } from '../theme/useThemedStyles';
import { useAppStore } from '../stores';
import { useWildlifeStore } from '../stores/wildlifeStore';
import type { EmbeddingPack } from '../types/wildlife';
import type { ModelFormat } from '../types';
import type { RootStackParamList } from '../navigation/types';
import { GANESHA_PROJECT_ID } from '../config/ganeshaApi';
import { MIEWID_LITERT_MODEL_NAME, MIEWID_MODEL_NAME } from '../config/modelSources';
import { resolveMiewidModelSource } from '../services/modelSourceResolver';
import { prepareMiewidModel } from '../services/miewidModelManager';
import {
  acquireLatestPack,
  checkLatestPackStatus,
} from '../services/packDownloadService';
import { ensureSignedIn } from '../utils/authGate';
import logger from '../utils/logger';
import { createStyles } from './PacksScreen.styles';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;

type PackUpdateState =
  | 'unchecked'
  | 'checking'
  | 'current'
  | 'available'
  | 'unavailable';

function formatBytes(bytes: number): string {
  if (bytes < MB) {
    return `${(bytes / KB).toFixed(1)} KB`;
  }
  if (bytes < GB) {
    return `${(bytes / MB).toFixed(1)} MB`;
  }
  return `${(bytes / GB).toFixed(1)} GB`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString();
}

/** GPU/LiteRT is Android-only; the toggle is a no-op elsewhere. */
function resolveDesiredModelFormat(preferGpuModel: boolean): ModelFormat {
  return preferGpuModel && Platform.OS === 'android' ? 'tflite' : 'onnx';
}

/**
 * packUpdateState only tracks pack freshness, so a GPU-preference flip
 * needs to be reachable through the Update button even when the pack
 * itself is already current -- otherwise handleDownloadPack's model
 * re-resolution would never run.
 */
function computeEffectivePackUpdateState(
  packUpdateState: PackUpdateState,
  installedFormat: ModelFormat | undefined,
  desiredFormat: ModelFormat,
): PackUpdateState {
  const formatMismatch = installedFormat != null && installedFormat !== desiredFormat;
  return packUpdateState === 'current' && formatMismatch ? 'available' : packUpdateState;
}

export const PacksScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const styles = useThemedStyles(createStyles);
  const { packs, miewidModel } = useWildlifeStore();
  const preferGpuModel = useAppStore((s) => s.preferGpuModel);
  const [isDownloading, setIsDownloading] = useState(false);
  const [packUpdateState, setPackUpdateState] =
    useState<PackUpdateState>('unchecked');
  const updateInFlight = useRef(false);
  const statusRequest = useRef(0);
  const effectivePackUpdateState = computeEffectivePackUpdateState(
    packUpdateState,
    miewidModel?.format,
    resolveDesiredModelFormat(preferGpuModel),
  );
  const installedProjectPack = packs.find(
    pack => pack.id === GANESHA_PROJECT_ID,
  );

  const handlePackPress = (pack: EmbeddingPack) => {
    navigation.navigate('PackDetails', { packId: pack.id });
  };

  const refreshPackStatus = useCallback(async () => {
    if (!installedProjectPack) {
      setPackUpdateState('unchecked');
      return;
    }
    const request = ++statusRequest.current;
    setPackUpdateState('checking');
    const result = await checkLatestPackStatus(
      GANESHA_PROJECT_ID,
      installedProjectPack,
    );
    if (request !== statusRequest.current) {
      return;
    }
    setPackUpdateState(
      result.ok ? (result.isLatest ? 'current' : 'available') : 'unavailable',
    );
  }, [installedProjectPack]);

  useFocusEffect(
    useCallback(() => {
      refreshPackStatus();
      return () => {
        statusRequest.current += 1;
      };
    }, [refreshPackStatus]),
  );

  const handleDownloadPack = useCallback(async () => {
    if (updateInFlight.current) {
      return;
    }
    updateInFlight.current = true;
    setIsDownloading(true);
    try {
      if (!(await ensureSignedIn(navigation))) {
        return;
      }
      const modelName =
        resolveDesiredModelFormat(preferGpuModel) === 'tflite'
          ? MIEWID_LITERT_MODEL_NAME
          : MIEWID_MODEL_NAME;
      const resolvedSource = await resolveMiewidModelSource(modelName);
      if (!resolvedSource.ok) {
        Alert.alert(
          'Download failed',
          `Could not reach the model server: ${resolvedSource.message}`,
        );
        return;
      }
      const installedModelIsCurrent =
        miewidModel?.status === 'ready' &&
        miewidModel.version === resolvedSource.source.version &&
        miewidModel.sha256?.toLowerCase() ===
          resolvedSource.source.expectedSha256.toLowerCase();

      // Resolve the latest model every time so a ready but outdated model is
      // replaced before installing a pack from a newer embedding space.
      let modelForPack = miewidModel;
      if (!installedModelIsCurrent) {
        modelForPack = await prepareMiewidModel(resolvedSource.source);
        if (modelForPack.status !== 'ready') {
          Alert.alert(
            'Download failed',
            `The MiewID model could not be prepared (status: ${modelForPack.status}).`,
          );
          return;
        }
      }

      const packResult = await acquireLatestPack(
        GANESHA_PROJECT_ID,
        {},
        modelForPack ?? undefined,
      );
      if (!packResult.ok) {
        Alert.alert(
          'Download failed',
          `Could not download the embedding pack: ${packResult.message}`,
        );
        return;
      }
      setPackUpdateState('current');
      logger.log(`[PacksScreen] Installed pack ${packResult.pack.id}`);
    } catch (error) {
      logger.error('[PacksScreen] Unexpected pack update failure:', error);
      Alert.alert(
        'Download failed',
        'The update could not be completed. Your current pack is still available.',
      );
    } finally {
      updateInFlight.current = false;
      setIsDownloading(false);
    }
  }, [miewidModel, navigation, preferGpuModel]);

  const handlePackStatusCheck = useCallback(async () => {
    if (updateInFlight.current) {
      return;
    }
    updateInFlight.current = true;
    try {
      if (await ensureSignedIn(navigation)) {
        await refreshPackStatus();
      }
    } catch (error) {
      logger.error('[PacksScreen] Pack status check failed:', error);
      setPackUpdateState('unavailable');
    } finally {
      updateInFlight.current = false;
    }
  }, [navigation, refreshPackStatus]);

  const updateStatusText = isDownloading
    ? 'Downloading and validating update...'
    : effectivePackUpdateState === 'checking'
      ? 'Checking for updates...'
      : effectivePackUpdateState === 'current'
        ? 'Up to date'
        : effectivePackUpdateState === 'available'
          ? 'Update available'
          : effectivePackUpdateState === 'unavailable'
            ? 'Unable to check for updates'
            : 'Update status not checked';

  const updateButtonTitle =
    effectivePackUpdateState === 'current'
      ? 'Check Again'
      : effectivePackUpdateState === 'available'
        ? 'Update to Latest Pack'
        : effectivePackUpdateState === 'checking'
          ? 'Checking for Updates'
          : 'Check for Updates';

  const renderPack = ({
    item,
    index,
  }: {
    item: EmbeddingPack;
    index: number;
  }) => (
    <AnimatedListItem
      index={index}
      onPress={() => handlePackPress(item)}
      testID={`pack-card-${index}`}
    >
      <Card>
        <Text style={styles.packName}>{item.displayName}</Text>
        <Text style={styles.packCount}>{item.individualCount} individuals</Text>
        <Text style={styles.packMeta}>
          Exported: {formatDate(item.exportDate)} ·{' '}
          {formatBytes(item.sizeBytes)}
        </Text>
      </Card>
    </AnimatedListItem>
  );

  return (
    <SafeAreaView
      style={styles.container}
      testID="packs-screen"
      edges={['top']}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Packs</Text>
      </View>

      {packs.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>No Packs Downloaded</Text>
          <Text style={styles.emptyText}>
            Download an embedding pack to start identifying individuals in the
            field.
          </Text>
          <Button
            title="Download Latest Pack"
            onPress={handleDownloadPack}
            loading={isDownloading}
            style={styles.downloadButton}
            testID="download-pack-button"
          />
        </View>
      ) : (
        <FlatList
          data={packs}
          renderItem={renderPack}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListFooterComponent={
            <View style={styles.updateSection}>
              <Text
                style={styles.updateStatus}
                accessibilityLiveRegion="polite"
                testID="pack-update-status"
              >
                {updateStatusText}
              </Text>
              <Button
                title={updateButtonTitle}
                onPress={
                  effectivePackUpdateState === 'available'
                    ? handleDownloadPack
                    : handlePackStatusCheck
                }
                loading={isDownloading || packUpdateState === 'checking'}
                style={styles.updateButton}
                testID="update-pack-button"
              />
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
};
