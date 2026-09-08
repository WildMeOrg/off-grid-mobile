import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { createNavigationContainerRef, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { IndividualsScreen } from '../../../src/screens/IndividualsScreen';
import { IndividualDetailScreen } from '../../../src/screens/IndividualDetailScreen';
import { IndividualImageScreen } from '../../../src/screens/IndividualImageScreen';
import type { RootStackParamList } from '../../../src/navigation/types';
import { loadBrowserIndividuals, loadReferencePhotos } from '../../../src/services/individualBrowser/files';
import { useWildlifeStore } from '../../../src/stores/wildlifeStore';
import { makeIndividual, makePack } from '../../utils/individualBrowserFixtures';

jest.unmock('@react-navigation/native');
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default);
jest.mock('react-native-vector-icons/Feather', () => 'Icon');
jest.mock('react-native-gesture-handler', () => {
  const gesture = () => ({ onStart: jest.fn().mockReturnThis(), onUpdate: jest.fn().mockReturnThis(), averageTouches: jest.fn().mockReturnThis() });
  return { GestureHandlerRootView: 'View', GestureDetector: 'View', Gesture: { Pinch: gesture, Pan: gesture, Simultaneous: jest.fn() } };
});
jest.mock('../../../src/services/individualBrowser/files', () => ({
  ...jest.requireActual('../../../src/services/individualBrowser/files'),
  loadBrowserIndividuals: jest.fn(), loadReferencePhotos: jest.fn(),
}));

const Stack = createNativeStackNavigator<RootStackParamList>();

it('preserves the search and native back stack through list, detail, and full-screen image', async () => {
  (loadBrowserIndividuals as jest.Mock).mockResolvedValue([makeIndividual(), makeIndividual({ id: 'individual-2', name: 'Zola' })]);
  (loadReferencePhotos as jest.Mock).mockResolvedValue([
    { key: 'reference:one.jpg', kind: 'reference', uri: '/mock/documents/embedding_packs/test/reference_photos/individual-1/one.jpg' },
  ]);
  await act(async () => { useWildlifeStore.setState({ packs: [makePack()], observations: [] }); });
  const navigation = createNavigationContainerRef<RootStackParamList>();
  const screen = render(
    <NavigationContainer ref={navigation}>
      <Stack.Navigator screenOptions={{ headerShown: false, animation: 'none' }} initialRouteName="Individuals">
        <Stack.Screen name="Individuals" component={IndividualsScreen} initialParams={{ packId: 'project-1' }} />
        <Stack.Screen name="IndividualDetail" component={IndividualDetailScreen} />
        <Stack.Screen name="IndividualImage" component={IndividualImageScreen} />
      </Stack.Navigator>
    </NavigationContainer>,
  );
  await screen.findByTestId('individual-row-individual-1', {}, { timeout: 5000 });
  fireEvent.changeText(screen.getByLabelText('Search individuals'), 'Button');
  await waitFor(() => expect(screen.queryByTestId('individual-row-individual-2')).toBeNull());
  fireEvent.press(screen.getByTestId('individual-row-individual-1'));
  await waitFor(() => expect(navigation.getCurrentRoute()?.name).toBe('IndividualDetail'));
  fireEvent.press(await screen.findByTestId('photo-reference:one.jpg'));
  await screen.findByTestId('inspected-image');
  expect(navigation.getCurrentRoute()?.name).toBe('IndividualImage');
  expect(navigation.getRootState().routes.map(route => route.name)).toEqual(['Individuals', 'IndividualDetail', 'IndividualImage']);
  await act(async () => { navigation.goBack(); });
  await waitFor(() => expect(navigation.getCurrentRoute()?.name).toBe('IndividualDetail'));
  await act(async () => { navigation.goBack(); });
  await screen.findByTestId('individual-row-individual-1');
  expect(navigation.getCurrentRoute()?.name).toBe('Individuals');
  expect(screen.getByLabelText('Search individuals').props.value).toBe('Button');
  expect(screen.queryByTestId('individual-row-individual-2')).toBeNull();
});