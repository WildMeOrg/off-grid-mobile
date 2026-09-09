import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { createNavigationContainerRef, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { IndividualsScreen } from '../../../src/screens/IndividualsScreen';
import { IndividualDetailScreen } from '../../../src/screens/IndividualDetailScreen';
import { IndividualImageScreen } from '../../../src/screens/IndividualImageScreen';
import type { RootStackParamList } from '../../../src/navigation/types';
import type { PackIndividual } from '../../../src/types';
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

it.each(['success', 'failure'])('keeps the catalog mounted until a same-pack return refresh settles: %s', async outcome => {
  const roster = [makeIndividual(), makeIndividual({ id: 'individual-2', name: 'Zola' })];
  (loadBrowserIndividuals as jest.Mock).mockResolvedValue(roster);
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
  const catalog = screen.getByTestId('individual-list');
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
  let finishRefresh: (individuals: PackIndividual[]) => void = () => undefined;
  let failRefresh: (error: Error) => void = () => undefined;
  (loadBrowserIndividuals as jest.Mock).mockImplementationOnce(() => new Promise<PackIndividual[]>((resolve, reject) => {
    finishRefresh = resolve;
    failRefresh = reject;
  }));
  await act(async () => { navigation.goBack(); });
  expect(screen.getByTestId('individual-list')).toBe(catalog);
  expect(screen.queryByTestId('browser-loading')).toBeNull();
  if (outcome === 'failure') {
    await act(async () => { failRefresh(new Error('Index unavailable')); });
    expect(screen.getByTestId('browser-error')).toBeTruthy();
    expect(screen.queryByTestId('individual-list')).toBeNull();
    return;
  }
  await act(async () => { finishRefresh([...roster]); });
  expect(screen.getByTestId('individual-list')).toBe(catalog);
  await screen.findByTestId('individual-row-individual-1');
  expect(navigation.getCurrentRoute()?.name).toBe('Individuals');
  expect(screen.getByLabelText('Search individuals').props.value).toBe('Button');
  expect(screen.queryByTestId('individual-row-individual-2')).toBeNull();
});