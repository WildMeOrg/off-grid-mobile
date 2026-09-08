import React, { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { FlatList, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/Feather';
import { AppSheet } from '../components';
import { useTheme, useThemedStyles } from '../theme';
import { useWildlifeStore } from '../stores/wildlifeStore';
import type { MainTabParamList, RootStackParamList } from '../navigation/types';
import { filterIndividuals } from '../services/individualBrowser/model';
import type { NameSort, SexFilter } from '../services/individualBrowser/model';
import { useBrowserPack } from './IndividualBrowser/hooks';
import { BrowserHeader, BrowserState, IndividualRow } from './IndividualBrowser/components';
import { createStyles } from './IndividualBrowser/styles';

const SEX_OPTIONS: Array<{ value: SexFilter; label: string }> = [
  { value: 'all', label: 'All' }, { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' }, { value: 'unknown', label: 'Unknown' },
];

export function IndividualsScreen() {
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'Individuals'> | RouteProp<MainTabParamList, 'IndividualsTab'>>();
  const packs = useWildlifeStore(state => state.packs);
  const [packId, setPackId] = useState<string | undefined>(() =>
    route.params?.packId ?? (packs.length === 1 ? packs[0].id : undefined));
  const [query, setQuery] = useState('');
  const [sex, setSex] = useState<SexFilter>('all');
  const [sort, setSort] = useState<NameSort>('asc');
  const [menu, setMenu] = useState<'pack' | 'sex' | null>(null);
  const browser = useBrowserPack(packId);
  const deferredQuery = useDeferredValue(query);
  const individuals = useMemo(() => filterIndividuals(browser.individuals, {
    query: deferredQuery, sex, sort,
  }), [browser.individuals, deferredQuery, sex, sort]);
  const supportsSex = browser.individuals.some(individual => individual.sex === 'male' || individual.sex === 'female');

  useEffect(() => {
    if (route.params?.packId) setPackId(route.params.packId);
  }, [route.params?.packId]);
  useEffect(() => {
    if (!packId && packs.length === 1) setPackId(packs[0].id);
  }, [packId, packs]);
  useEffect(() => { setSex('all'); }, [browser.identity]);

  const missingText = packId ? 'Pack removed or unavailable' : (packs.length ? 'Select an installed pack' : 'No installed packs');
  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']} testID="individuals-screen">
      <BrowserHeader title="Individuals" onBack={route.name === 'Individuals' ? () => navigation.goBack() : undefined} />
      <View style={styles.controls}>
        <TouchableOpacity style={styles.selector} onPress={() => setMenu('pack')} accessibilityRole="button" accessibilityLabel="Select pack">
          <Icon name="archive" size={20} color={colors.primary} />
          <Text style={[styles.body, styles.flexible]}>{browser.pack?.displayName ?? 'Select pack'}</Text>
          <Icon name="chevron-down" size={20} color={colors.textSecondary} />
        </TouchableOpacity>
        {browser.status === 'ready' && <>
          <View style={styles.search}>
            <Icon name="search" size={20} color={colors.textMuted} />
            <TextInput style={styles.input} value={query} onChangeText={setQuery} placeholder="Name, ID or alias"
              placeholderTextColor={colors.textMuted} accessibilityLabel="Search individuals" autoCorrect={false} />
            {!!query && <TouchableOpacity style={styles.iconButton} onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel="Clear search">
              <Icon name="x" size={20} color={colors.textSecondary} />
            </TouchableOpacity>}
          </View>
          <View style={styles.controlRow}>
            <TouchableOpacity style={styles.selector} onPress={() => setSort(sort === 'asc' ? 'desc' : 'asc')}
              accessibilityRole="button" accessibilityLabel={sort === 'asc' ? 'Sort name Z to A' : 'Sort name A to Z'}>
              <Icon name={sort === 'asc' ? 'arrow-down' : 'arrow-up'} size={20} color={colors.primary} />
              <Text style={styles.secondary}>{sort === 'asc' ? 'Name A-Z' : 'Name Z-A'}</Text>
            </TouchableOpacity>
            {supportsSex && <TouchableOpacity style={styles.selector} onPress={() => setMenu('sex')} accessibilityRole="button" accessibilityLabel="Filter by sex">
              <Icon name="filter" size={20} color={colors.primary} />
              <Text style={styles.secondary}>{`Sex: ${SEX_OPTIONS.find(option => option.value === sex)?.label}`}</Text>
            </TouchableOpacity>}
          </View>
          <Text style={styles.secondary}>{`${individuals.length} individuals`}</Text>
        </>}
      </View>
      {browser.status === 'ready' && browser.pack ? (
        <FlatList data={individuals} keyExtractor={individual => individual.id} extraData={browser.identity}
          initialNumToRender={12} maxToRenderPerBatch={12} windowSize={5} keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.listContent} testID="individual-list"
          renderItem={({ item }) => <IndividualRow pack={browser.pack!} individual={item}
            onPress={() => navigation.navigate('IndividualDetail', { packId: browser.pack!.id, individualId: item.id })} />}
          ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyText}>
            {browser.individuals.length ? 'No individuals match your search' : 'No individuals in this pack'}
          </Text></View>} />
      ) : <BrowserState status={browser.status} onRetry={browser.retry} missingText={missingText} />}
      <AppSheet visible={menu === 'pack'} onClose={() => setMenu(null)} title="Installed packs" closeLabel="Close">
        <FlatList data={packs} keyExtractor={pack => pack.id} style={styles.choiceList}
          ListEmptyComponent={<Text style={styles.emptyText}>No installed packs</Text>}
          renderItem={({ item }) => <TouchableOpacity style={styles.choice} accessibilityRole="radio"
            accessibilityState={{ selected: item.id === packId }} accessibilityLabel={`Select ${item.displayName}`}
            onPress={() => { setPackId(item.id); setQuery(''); setSex('all'); setMenu(null); }}>
            <View style={styles.choiceRow}>
              <Icon name={item.id === packId ? 'check-circle' : 'circle'} size={20} color={colors.primary} />
              <Text style={[styles.body, styles.flexible]}>{item.displayName}</Text>
            </View>
            <Text style={styles.secondary}>{`${item.id} | ${item.packVersion}${item.status === 'quarantined' ? ' | Quarantined' : ''}`}</Text>
          </TouchableOpacity>} />
      </AppSheet>
      <AppSheet visible={menu === 'sex'} onClose={() => setMenu(null)} title="Sex" closeLabel="Close">
        {SEX_OPTIONS.map(option => <TouchableOpacity key={option.value} style={styles.choice}
          accessibilityRole="radio" accessibilityState={{ selected: option.value === sex }}
          onPress={() => { setSex(option.value); setMenu(null); }}>
          <View style={styles.choiceRow}>
            <Icon name={sex === option.value ? 'check-circle' : 'circle'} size={20} color={colors.primary} />
            <Text style={styles.body}>{option.label}</Text>
          </View>
        </TouchableOpacity>)}
      </AppSheet>
    </SafeAreaView>
  );
}