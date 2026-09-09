import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../../theme';
import type { RootStackParamList } from '../../navigation/types';
import type { Detection } from '../../types';
import { useBrowserPack } from './hooks';
import { createStyles } from './styles';

function IndividualLink({ packId, individualId }: { packId: string; individualId: string }) {
  const browser = useBrowserPack(packId);
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  if (!browser.individuals.some(individual => individual.id === individualId)) return null;
  return (
    <TouchableOpacity style={styles.selector} onPress={() => navigation.navigate('IndividualDetail', { packId, individualId })}
      accessibilityRole="button" accessibilityLabel={`View individual ${individualId}`}>
      <Icon name="user" size={20} color={colors.primary} />
      <Text style={styles.secondary}>View individual</Text>
    </TouchableOpacity>
  );
}

export function ReviewedIndividualLink({ detection }: { detection: Detection }) {
  const { projectId } = detection.encounterFields;
  const { approvedIndividual, reviewStatus } = detection.matchResult;
  if (reviewStatus !== 'approved' || !projectId || !approvedIndividual || approvedIndividual.startsWith('FIELD-')) return null;
  return <IndividualLink packId={projectId} individualId={approvedIndividual} />;
}