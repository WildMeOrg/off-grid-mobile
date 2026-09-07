import { useState, useCallback } from 'react';
import { Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useWildlifeStore } from '../../stores/wildlifeStore';
import type { RootStackParamList } from '../../navigation/types';
import {
  errorMessage,
  getDeviceLocation,
  getDeviceInfo,
  checkBatchResourceWarnings,
  confirmProceedDespiteWarning,
  prepareSpeciesConfigs,
  runPipelineForOnePhoto,
} from './captureFlowHelpers';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

export function useCaptureFlow() {
  const [isProcessing, setIsProcessing] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(
    null,
  );
  const navigation = useNavigation<NavigationProp>();
  const packs = useWildlifeStore(s => s.packs);
  const miewidModel = useWildlifeStore(s => s.miewidModel);

  const processPhoto = useCallback(
    async (photoUri: string) => {
      setIsProcessing(true);
      try {
        const speciesConfigs = await prepareSpeciesConfigs(miewidModel, packs);
        if (!speciesConfigs) {
          return;
        }

        const gps = await getDeviceLocation();
        const deviceInfo = getDeviceInfo();
        const outcome = await runPipelineForOnePhoto(photoUri, speciesConfigs, {
          gps,
          deviceInfo,
          miewidModel,
        });

        if (!outcome.ok) {
          Alert.alert('Detection Failed', outcome.message);
          return;
        }

        navigation.navigate('DetectionResults', {
          observationId: outcome.observationId,
        });

        // Partial failure: the observation is saved with what completed;
        // tell the user what was lost.
        if (outcome.errors.length > 0) {
          Alert.alert(
            'Some detections failed',
            outcome.errors
              .map(e => (e.species ? `${e.species}: ${e.message}` : e.message))
              .join('\n'),
          );
        }
      } catch (error) {
        Alert.alert('Detection Failed', errorMessage(error));
      } finally {
        setIsProcessing(false);
      }
    },
    [miewidModel, packs, navigation],
  );

  /**
   * Process many already-taken photos sequentially (one interpreter, one
   * photo at a time -- no concurrency). Unlike processPhoto, this never
   * navigates per-photo; it lands on the Observations tab once the whole
   * batch finishes so the person reviews at their own pace.
   */
  const processBatch = useCallback(
    async (photoUris: string[]) => {
      if (photoUris.length === 0) {
        return;
      }

      setIsProcessing(true);
      setBatchProgress({ current: 0, total: photoUris.length });
      try {
        const speciesConfigs = await prepareSpeciesConfigs(miewidModel, packs);
        if (!speciesConfigs) {
          return;
        }

        const warning = await checkBatchResourceWarnings();
        if (warning && !(await confirmProceedDespiteWarning(warning, photoUris.length))) {
          return;
        }

        // Looked up once for the whole batch, not per photo -- these are
        // already-taken gallery photos, so re-querying GPS per photo would
        // only add per-photo permission/timeout latency without making the
        // location any more accurate.
        const context = {
          gps: await getDeviceLocation(),
          deviceInfo: getDeviceInfo(),
          miewidModel,
        };

        let succeeded = 0;
        const failures: string[] = [];
        for (let i = 0; i < photoUris.length; i += 1) {
          setBatchProgress({ current: i + 1, total: photoUris.length });
          const outcome = await runPipelineForOnePhoto(photoUris[i], speciesConfigs, context);
          if (outcome.ok) {
            succeeded += 1;
          } else {
            failures.push(`Photo ${i + 1}: ${outcome.message}`);
          }
        }

        navigation.navigate('Main', { screen: 'ObservationsTab' });

        const summary = `Saved ${succeeded} of ${photoUris.length} photo${photoUris.length === 1 ? '' : 's'} as observations.`;
        if (failures.length > 0) {
          Alert.alert('Batch import finished with errors', `${summary}\n\n${failures.join('\n')}`);
        } else {
          Alert.alert('Batch import complete', summary);
        }
      } catch (error) {
        Alert.alert('Batch import failed', errorMessage(error));
      } finally {
        setIsProcessing(false);
        setBatchProgress(null);
      }
    },
    [miewidModel, packs, navigation],
  );

  const takePhoto = useCallback(async () => {
    const result = await launchCamera({ mediaType: 'photo', quality: 1 });
    if (result.assets?.[0]?.uri) {
      await processPhoto(result.assets[0].uri);
    }
  }, [processPhoto]);

  const chooseFromGallery = useCallback(async () => {
    const result = await launchImageLibrary({
      mediaType: 'photo',
      quality: 1,
      selectionLimit: 0,
    });
    const uris = (result.assets ?? [])
      .map(asset => asset.uri)
      .filter((uri): uri is string => !!uri);

    if (uris.length === 0) {
      return;
    }
    if (uris.length === 1) {
      await processPhoto(uris[0]);
    } else {
      await processBatch(uris);
    }
  }, [processPhoto, processBatch]);

  return { isProcessing, batchProgress, takePhoto, chooseFromGallery };
}
