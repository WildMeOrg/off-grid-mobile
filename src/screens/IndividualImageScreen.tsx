import React from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../theme';
import type { RootStackParamList } from '../navigation/types';
import { individualName } from '../services/individualBrowser/model';
import { useIndividualBrowser, usePhotoUri } from './IndividualBrowser/hooks';
import type { BrowserPhoto } from './IndividualBrowser/hooks';
import { BrowserHeader, BrowserState } from './IndividualBrowser/components';
import { photoLabel } from './IndividualBrowser/PhotoTile';
import { ZoomPhoto } from './IndividualBrowser/ZoomPhoto';
import { createStyles } from './IndividualBrowser/detail.styles';

function InspectedPhoto({ photo }: { photo: BrowserPhoto }) {
  const { path, loading } = usePhotoUri(photo);
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  if (!path) return <View style={styles.empty}>
    {loading && <ActivityIndicator color={colors.primary} />}
    <Text style={styles.emptyText}>{loading ? 'Loading image' : 'Image unavailable'}</Text>
  </View>;
  return <ZoomPhoto key={path} path={path} />;
}

export function IndividualImageScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList, 'IndividualImage'>>();
  const { params } = useRoute<RouteProp<RootStackParamList, 'IndividualImage'>>();
  const browser = useIndividualBrowser(params.packId, params.individualId);
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const photoIndex = browser.photos.findIndex(photo => photo.key === params.imageKey);
  const photo = browser.photos[photoIndex];
  const showPhoto = (index: number) => {
    const next = browser.photos[index];
    if (next) navigation.setParams({ imageKey: next.key });
  };
  const hasIndividual = browser.status === 'ready' && browser.individual;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']} testID="individual-image-screen">
      <BrowserHeader title={browser.individual ? individualName(browser.individual) : 'Individual image'} onBack={() => navigation.goBack()} />
      {browser.status !== 'ready' ? <BrowserState status={browser.status} onRetry={browser.retry} /> : <>
        {!hasIndividual || !photo ? <View style={styles.empty}>
          <Text style={styles.emptyText}>{hasIndividual && browser.references.loading
            ? 'Loading image' : 'Image no longer available for this individual'}</Text>
        </View> : <>
          <View style={styles.controls}>
            <Text style={styles.body}>{photoLabel(photo)}</Text>
            {photo.kind !== 'reference' && <Text style={styles.notice}>Local field-review links are not WhiskerBook identity confirmation.</Text>}
          </View>
          <InspectedPhoto key={`${browser.identity}:${photo.key}`} photo={photo} />
          <View style={styles.header}>
            <TouchableOpacity style={styles.iconButton} onPress={() => showPhoto(photoIndex - 1)} disabled={photoIndex === 0}
              accessibilityRole="button" accessibilityLabel="Previous image" accessibilityState={{ disabled: photoIndex === 0 }}>
              <Icon name="chevron-left" size={24} color={photoIndex === 0 ? colors.textDisabled : colors.text} />
            </TouchableOpacity>
            <Text style={[styles.emptyText, styles.flexible]}>{`${photoIndex + 1} / ${browser.photos.length}`}</Text>
            <TouchableOpacity style={styles.iconButton} onPress={() => showPhoto(photoIndex + 1)} disabled={photoIndex === browser.photos.length - 1}
              accessibilityRole="button" accessibilityLabel="Next image" accessibilityState={{ disabled: photoIndex === browser.photos.length - 1 }}>
              <Icon name="chevron-right" size={24} color={photoIndex === browser.photos.length - 1 ? colors.textDisabled : colors.text} />
            </TouchableOpacity>
          </View>
        </>}
      </>}
    </SafeAreaView>
  );
}