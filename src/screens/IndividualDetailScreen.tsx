import React from 'react';
import { FlatList, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useThemedStyles } from '../theme';
import type { RootStackParamList } from '../navigation/types';
import { individualFields, individualName } from '../services/individualBrowser/model';
import { useIndividualBrowser } from './IndividualBrowser/hooks';
import { BrowserHeader, BrowserState } from './IndividualBrowser/components';
import { PhotoTile } from './IndividualBrowser/PhotoTile';
import { createStyles } from './IndividualBrowser/detail.styles';

export function IndividualDetailScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { params } = useRoute<RouteProp<RootStackParamList, 'IndividualDetail'>>();
  const browser = useIndividualBrowser(params.packId, params.individualId);
  const styles = useThemedStyles(createStyles);
  const inspectPhoto = (imageKey: string) => navigation.navigate('IndividualImage', { ...params, imageKey });
  const header = <BrowserHeader title={browser.individual ? individualName(browser.individual) : 'Individual'} onBack={() => navigation.goBack()} />;

  if (browser.status !== 'ready' || !browser.individual) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']} testID="individual-detail-screen">
        {header}
        {browser.status !== 'ready' ? <BrowserState status={browser.status} onRetry={browser.retry} /> : (
          <View style={styles.empty}><Text style={styles.emptyText}>Individual unavailable in this pack</Text></View>
        )}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']} testID="individual-detail-screen">
      {header}
      <FlatList data={browser.localEvidence} keyExtractor={photo => photo.key} extraData={browser.identity}
        initialNumToRender={4} maxToRenderPerBatch={4} windowSize={5} contentContainerStyle={styles.listContent}
        ListHeaderComponent={<>
          <View style={styles.section}>
            <Text style={styles.secondary}>{browser.pack?.displayName}</Text>
            {individualFields(browser.individual).map(field => <View style={styles.field} key={field.label}>
              <Text style={styles.secondary}>{field.label}</Text>
              <Text style={styles.body} selectable>{field.value}</Text>
            </View>)}
          </View>
          <View style={styles.section}>
            <Text style={styles.sectionTitle} accessibilityRole="header">Pack references</Text>
            {browser.references.photos.length ? <View style={styles.referenceRow}>
              {browser.references.photos.map(photo => <PhotoTile key={`${browser.identity}:${photo.key}`} photo={photo} onPress={() => inspectPhoto(photo.key)} />)}
            </View> : <Text style={styles.secondary}>{browser.references.loading ? 'Loading references' : 'No reference images available'}</Text>}
          </View>
          <View style={styles.section}>
            <Text style={styles.sectionTitle} accessibilityRole="header">Locally reviewed photos</Text>
            <Text style={styles.notice}>Local field-review links are not WhiskerBook identity confirmation.</Text>
          </View>
        </>}
        renderItem={({ item }) => <View style={styles.localPhoto}>
          <PhotoTile key={`${browser.identity}:${item.key}`} photo={item} onPress={() => inspectPhoto(item.key)} />
        </View>}
        ListEmptyComponent={<View style={styles.inlineEmpty}><Text style={styles.secondary}>No approved local photos for this individual</Text></View>} />
    </SafeAreaView>
  );
}