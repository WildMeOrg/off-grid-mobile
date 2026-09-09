import type { Observation, PackIndividual } from '../../types';
import { toDisplayUri } from '../../utils/imageUri';

export type SexFilter = 'all' | 'male' | 'female' | 'unknown';
export type NameSort = 'asc' | 'desc';

const populatedText = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

export const individualName = (individual: PackIndividual): string =>
  populatedText(individual.name) ?? individual.id;

export function individualFields(individual: PackIndividual): Array<{ label: string; value: string }> {
  const fields = [
    { label: 'ID', value: individual.id },
    { label: 'Alias', value: populatedText(individual.alternateId) },
    { label: 'Sex', value: ['male', 'female'].includes(individual.sex ?? '') ? individual.sex : null },
    { label: 'Life stage', value: populatedText(individual.lifeStage) },
  ];
  return fields.filter((field): field is { label: string; value: string } => field.value !== null);
}

export function filterIndividuals(
  individuals: PackIndividual[],
  options: { query: string; sex: SexFilter; sort: NameSort },
): PackIndividual[] {
  const query = options.query.trim().toLocaleLowerCase();
  return individuals.filter(individual => {
    const sex = individual.sex === 'male' || individual.sex === 'female' ? individual.sex : 'unknown';
    return (options.sex === 'all' || options.sex === sex)
      && [individual.id, individual.name, individual.alternateId].some(value =>
        populatedText(value)?.toLocaleLowerCase().includes(query));
  }).sort((left, right) => {
    const byName = individualName(left).localeCompare(individualName(right), undefined, { sensitivity: 'base', numeric: true });
    const order = byName || left.id.localeCompare(right.id);
    return options.sort === 'asc' ? order : -order;
  });
}

export interface LocalEvidence {
  key: string;
  kind: 'source' | 'crop';
  uri: string;
  observationId: string;
  detectionId: string;
}

interface EvidenceContext {
  observations: Observation[];
  packId: string;
  individualId: string;
}

export function composeLocalEvidence({
  observations, packId, individualId,
}: EvidenceContext): LocalEvidence[] {
  if (!packId || individualId.startsWith('FIELD-')) {
    return [];
  }
  const evidence: LocalEvidence[] = [];
  const sources = new Set<string>();
  for (const observation of observations) {
    for (const detection of observation.detections) {
      if (detection.matchResult.reviewStatus !== 'approved'
        || detection.matchResult.approvedIndividual !== individualId
        || detection.encounterFields.projectId !== packId
        || detection.observationId !== observation.id) {
        continue;
      }
      const identity = { observationId: observation.id, detectionId: detection.id };
      const sourceUri = toDisplayUri(observation.photoUri);
      if (observation.photoUri && !sources.has(sourceUri)) {
        sources.add(sourceUri);
        evidence.push({
          ...identity,
          key: JSON.stringify(['source', observation.id]),
          kind: 'source',
          uri: observation.photoUri,
        });
      }
      if (detection.croppedImageUri) {
        evidence.push({
          ...identity,
          key: JSON.stringify(['crop', observation.id, detection.id]),
          kind: 'crop',
          uri: detection.croppedImageUri,
        });
      }
    }
  }
  return evidence;
}