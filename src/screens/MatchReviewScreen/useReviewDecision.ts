import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { useNavigation, usePreventRemove } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/types';
import type { Detection } from '../../types';
import { useWildlifeStore } from '../../stores';
import logger from '../../utils/logger';

export function useReviewDecision(observationId: string, detection: Detection | null) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList, 'MatchReview'>>();
  const saveInFlight = useRef(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const isSaving = saveStatus === 'saving';
  usePreventRemove(isSaving, () => undefined);

  useEffect(() => {
    if (saveStatus === 'saved' && saveInFlight.current) {
      saveInFlight.current = false;
      navigation.goBack();
    }
  }, [saveStatus, navigation]);

  const goBack = useCallback(() => {
    if (!saveInFlight.current) navigation.goBack();
  }, [navigation]);

  const saveDecision = useCallback(async (selectedIndividualId: string | null) => {
    if (!detection || saveInFlight.current) return;
    saveInFlight.current = true;
    setSaveStatus('saving');
    const store = useWildlifeStore.getState();
    try {
      const individualId = selectedIndividualId ?? store.getNextFieldId();
      await store.updateDetection(observationId, detection.id, {
        matchResult: {
          ...detection.matchResult,
          approvedIndividual: individualId,
          reviewStatus: 'approved',
        },
      });

      if (selectedIndividualId === null) {
        await Promise.resolve(store.addLocalIndividual({
          localId: individualId,
          userLabel: null,
          species: detection.species,
          embeddings: [detection.embedding],
          referencePhotos: [detection.croppedImageUri],
          firstSeen: new Date().toISOString(),
          encounterCount: 1,
          syncStatus: 'pending',
          wildbookId: null,
        }));
      } else if (detection.matchResult.topCandidates.some(
        candidate => candidate.individualId === individualId && candidate.source === 'local',
      )) {
        await Promise.resolve(store.addEmbeddingToLocalIndividual(
          individualId, detection.embedding, detection.croppedImageUri,
        ));
      }
      setSaveStatus('saved');
    } catch (error) {
      logger.error('[MatchReview] Failed to save review decision:', error);
      Alert.alert('Save failed', 'The review could not be saved. Please try again.');
      saveInFlight.current = false;
      setSaveStatus('idle');
    }
  }, [detection, observationId]);

  return { isSaving, saveDecision, goBack };
}