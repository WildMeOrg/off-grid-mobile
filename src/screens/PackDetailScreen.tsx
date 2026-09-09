import React from 'react';
import { Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/Feather';
import { Button } from '../components';
import { BrowserHeader } from './IndividualBrowser/components';
import { useThemedStyles } from '../theme/useThemedStyles';
import { useTheme } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';
import { useWildlifeStore } from '../stores/wildlifeStore';
import type { RootStackParamList } from '../navigation/types';

type PackDetailRouteProp = RouteProp<RootStackParamList, 'PackDetails'>;

const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: SPACING.lg,
  },
  title: {
    ...TYPOGRAPHY.h2,
    color: colors.text,
    marginBottom: SPACING.sm,
  },
  label: {
    ...TYPOGRAPHY.labelSmall,
    color: colors.textMuted,
    marginTop: SPACING.md,
    marginBottom: SPACING.xs,
  },
  value: {
    ...TYPOGRAPHY.body,
    color: colors.text,
  },
  notFound: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  notFoundText: {
    ...TYPOGRAPHY.body,
    color: colors.textMuted,
  },
});

export const PackDetailScreen: React.FC = () => {
  const route = useRoute<PackDetailRouteProp>();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { packId } = route.params;
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const pack = useWildlifeStore((s) => s.packs.find((p) => p.id === packId));
  const miewidModel = useWildlifeStore((s) => s.miewidModel);

  if (!pack) {
    return (
      <SafeAreaView
        style={styles.container}
        testID="pack-detail-screen">
        <BrowserHeader title="Pack" onBack={() => navigation.goBack()} />
        <Text style={styles.notFoundText}>Pack not found</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} testID="pack-detail-screen">
      <BrowserHeader title="Pack" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{pack.displayName}</Text>
        <Button title="Browse individuals" onPress={() => navigation.navigate('Individuals', { packId })}
          icon={<Icon name="users" size={20} color={colors.primary} />} testID="browse-pack-individuals" />

        <Text style={styles.label}>Species</Text>
        <Text style={styles.value}>{pack.species}</Text>

        <Text style={styles.label}>Feature Class</Text>
        <Text style={styles.value}>{pack.featureClass}</Text>

        <Text style={styles.label}>Individuals</Text>
        <Text style={styles.value}>
          {pack.individualCount} known individuals
        </Text>

        <Text style={styles.label}>Pack Version</Text>
        <Text style={styles.value}>{pack.packVersion}</Text>

        <Text style={styles.label}>Embedding Model Version</Text>
        <Text style={styles.value}>{pack.embeddingModelVersion}</Text>

        <Text style={styles.label}>Installed MiewID Version</Text>
        <Text style={styles.value}>{miewidModel?.version ?? 'Not installed'}</Text>

        <Text style={styles.label}>Embedding Dimension</Text>
        <Text style={styles.value}>{pack.embeddingDim}</Text>

        <Text style={styles.label}>Exported</Text>
        <Text style={styles.value}>{pack.exportDate}</Text>

        <Text style={styles.label}>Pack Directory</Text>
        <Text style={[styles.value, { color: colors.textMuted }]}>
          {pack.packDir}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
};
