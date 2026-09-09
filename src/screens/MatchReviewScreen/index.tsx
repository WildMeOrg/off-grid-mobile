import React, { useCallback, useMemo } from 'react';
import { View, Text, Image, TouchableOpacity, FlatList } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/Feather';
import type { RouteProp } from '@react-navigation/native';
import { useThemedStyles, useTheme } from '../../theme';
import { useWildlifeStore } from '../../stores';
import type { RootStackParamList } from '../../navigation/types';
import type { MatchCandidate } from '../../types';
import { toDisplayUri } from '../../utils/imageUri';
import { SPACING } from '../../constants';
import { CandidateCard } from './CandidateCard';
import { createStyles } from './styles';
import { usePackIndividualInfo } from './usePackIndividualInfo';
import { useReviewDecision } from './useReviewDecision';

type MatchReviewRouteProp = RouteProp<RootStackParamList, 'MatchReview'>;

interface ResolvedCandidate {
  candidate: MatchCandidate;
  name: string;
  displayId: string;
  refPhotoUri: string | null;
  packId?: string;
}

export const MatchReviewScreen: React.FC = () => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const insets = useSafeAreaInsets();
  const route = useRoute<MatchReviewRouteProp>();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { observationId, detectionId } = route.params;

  const observation = useWildlifeStore(s =>
    s.observations.find(o => o.id === observationId),
  );
  const localIndividuals = useWildlifeStore(s => s.localIndividuals);
  const packs = useWildlifeStore(s => s.packs);

  const detection = useMemo(
    () => observation?.detections.find(d => d.id === detectionId) ?? null,
    [observation, detectionId],
  );
  const { isSaving, saveDecision, goBack } = useReviewDecision(observationId, detection);

  const candidates = useMemo(() => detection?.matchResult.topCandidates ?? [], [detection]);
  const scopedPacks = useMemo(() => packs.filter(pack =>
    pack.id === detection?.encounterFields.projectId && pack.status === 'ready'),
  [packs, detection?.encounterFields.projectId]);
  const packIndividualInfo = usePackIndividualInfo(candidates, scopedPacks);

  const resolvedCandidates: ResolvedCandidate[] = useMemo(() => {
    return candidates.map(candidate => {
      if (candidate.source === 'local') {
        const local = localIndividuals.find(
          ind => ind.localId === candidate.individualId,
        );
        return {
          candidate,
          name: local?.userLabel ?? 'Unnamed Individual',
          displayId: candidate.individualId,
          refPhotoUri:
            local?.referencePhotos?.[candidate.refPhotoIndex] ?? null,
        };
      }

      // Pack individual -- name and reference photo are resolved
      // asynchronously above from the pack's embeddings/index.json; fall
      // back to the raw ID until that resolves.
      const info = packIndividualInfo[candidate.individualId];
      return {
        candidate,
        name: info?.name ?? candidate.individualId,
        displayId: candidate.individualId,
        refPhotoUri: info?.refPhotoUri ?? null,
        packId: info?.packId,
      };
    });
  }, [candidates, localIndividuals, packIndividualInfo]);

  const renderCandidate = useCallback(
    ({ item, index }: { item: ResolvedCandidate; index: number }) => (
      <CandidateCard
        candidate={item.candidate}
        rank={index + 1}
        name={item.name}
        displayId={item.displayId}
        refPhotoUri={item.refPhotoUri}
        onViewIndividual={item.packId ? () => navigation.navigate('IndividualDetail', {
          packId: item.packId!, individualId: item.candidate.individualId,
        }) : undefined}
        onApprove={saveDecision}
        isSaving={isSaving}
        styles={styles}
      />
    ),
    [saveDecision, isSaving, styles, navigation],
  );

  const keyExtractor = useCallback(
    (item: ResolvedCandidate) => item.candidate.individualId,
    [],
  );

  if (!detection) {
    return (
      <SafeAreaView
        style={styles.container}
        testID="match-review-screen"
        edges={['top']}
      >
        <View style={styles.header}>
          <TouchableOpacity
            onPress={goBack}
            style={styles.backButton}
            testID="back-button"
          >
            <Icon name="arrow-left" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Match Review</Text>
          <View style={styles.backButton} />
        </View>
        <Text style={styles.emptyText}>Detection not found.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={styles.container}
      testID="match-review-screen"
      edges={['top']}
    >
      <View style={styles.header}>
        <TouchableOpacity
          onPress={goBack}
          disabled={isSaving}
          style={styles.backButton}
          testID="back-button"
        >
          <Icon name="arrow-left" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Match Review</Text>
        <View style={styles.backButton} />
      </View>

      <View style={styles.detectionSection}>
        <Image
          source={{ uri: toDisplayUri(detection.croppedImageUri) }}
          style={styles.croppedImage}
          resizeMode="cover"
          testID="cropped-detection-image"
        />
        <View style={styles.speciesRow}>
          <Text style={styles.speciesText}>{detection.species}</Text>
        </View>
      </View>

      <Text style={styles.candidatesHeader}>
        Top Candidates ({candidates.length})
      </Text>

      <FlatList
        style={styles.candidatesList}
        contentContainerStyle={styles.candidatesContent}
        data={resolvedCandidates}
        renderItem={renderCandidate}
        keyExtractor={keyExtractor}
        testID="candidates-list"
        ListEmptyComponent={
          <Text style={styles.emptyText}>No candidates found.</Text>
        }
      />

      <View style={[styles.footer, { paddingBottom: SPACING.md + insets.bottom }]} testID="match-review-footer">
        <TouchableOpacity
          style={styles.newIndividualButton}
          onPress={() => saveDecision(null)}
          disabled={isSaving}
          accessibilityState={{ disabled: isSaving, busy: isSaving }}
          testID="no-match-button"
        >
          <Icon name="user-plus" size={18} color={colors.text} />
          <Text style={styles.newIndividualText}>
            No Match — New Individual
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.skipButton}
          onPress={goBack}
          disabled={isSaving}
          testID="skip-button"
        >
          <Text style={styles.skipText}>Skip</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};
