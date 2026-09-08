import React, { useEffect } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { triggerHaptic } from '../utils/haptics';
import { useAppStore } from '../stores';
import {
  OnboardingScreen,
  SettingsScreen,
  SecuritySettingsScreen,
  WildlifeHomeScreen,
  PacksScreen,
  PackDetailScreen,
  CaptureScreen,
  DetectionResultsScreen,
  MatchReviewScreen,
  ObservationsScreen,
  ObservationDetailScreen,
  SyncScreen,
  SignInScreen,
  SelectRoleScreen,
} from '../screens';
import type { RootStackParamList, MainTabParamList } from './types';

const RootStack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();

// Animated tab icon with scale spring on focus
const TAB_ICON_MAP: Record<string, string> = {
  HomeTab: 'home',
  PacksTab: 'archive',
  ObservationsTab: 'eye',
  SyncTab: 'upload-cloud',
};

const TabBarIcon: React.FC<{ name: string; focused: boolean }> = ({ name, focused }) => {
  const { colors } = useTheme();
  const tabStyles = useThemedStyles(createTabBarStyles);
  const scale = useSharedValue(focused ? 1.1 : 1);

  useEffect(() => {
    scale.value = withSpring(focused ? 1.1 : 1, { damping: 15, stiffness: 150 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <View style={tabStyles.iconContainer}>
      <Animated.View style={animatedStyle}>
        <Icon
          name={TAB_ICON_MAP[name] || 'circle'}
          size={22}
          color={focused ? colors.primary : colors.textMuted}
        />
      </Animated.View>
      {focused && <View style={tabStyles.focusDot} />}
    </View>
  );
};

const createTabBarStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  iconContainer: {
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  focusDot: {
    position: 'absolute' as const,
    top: -6,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.primary,
  },
});

// Main Tab Navigator
const MainTabs: React.FC = () => {
  const { colors, shadows } = useTheme();
  const insets = useSafeAreaInsets();
  const bottomInset = Math.max(insets.bottom, 20);

  return (
    <Tab.Navigator
      backBehavior="history"
      screenOptions={({ route }) => ({
        headerShown: false,
        animation: 'fade',
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: 60 + bottomInset,
          paddingBottom: bottomInset,
          paddingTop: 10,
          ...shadows.medium,
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        // eslint-disable-next-line react/no-unstable-nested-components
        tabBarIcon: ({ focused }) => (
          <TabBarIcon name={route.name} focused={focused} />
        ),
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '500' as const,
        },
      })}
    >
      <Tab.Screen
        name="HomeTab"
        component={WildlifeHomeScreen}
        options={{ tabBarLabel: 'Home', tabBarButtonTestID: 'home-tab' }}
        listeners={() => ({
          tabPress: () => { triggerHaptic('selection'); },
        })}
      />
      <Tab.Screen
        name="PacksTab"
        component={PacksScreen}
        options={{ tabBarLabel: 'Packs', tabBarButtonTestID: 'packs-tab' }}
        listeners={() => ({
          tabPress: () => { triggerHaptic('selection'); },
        })}
      />
      <Tab.Screen
        name="ObservationsTab"
        component={ObservationsScreen}
        options={{ tabBarLabel: 'Observations', tabBarButtonTestID: 'observations-tab' }}
        listeners={() => ({
          tabPress: () => { triggerHaptic('selection'); },
        })}
      />
      <Tab.Screen
        name="SyncTab"
        component={SyncScreen}
        options={{ tabBarLabel: 'Upload', tabBarButtonTestID: 'sync-tab' }}
        listeners={() => ({
          tabPress: () => { triggerHaptic('selection'); },
        })}
      />
    </Tab.Navigator>
  );
};

// Root Navigator
export const AppNavigator: React.FC = () => {
  const { colors } = useTheme();
  const hasCompletedOnboarding = useAppStore((s) => s.hasCompletedOnboarding);

  const initialRoute: keyof RootStackParamList = hasCompletedOnboarding
    ? 'Main'
    : 'Onboarding';

  return (
    <RootStack.Navigator
      initialRouteName={initialRoute}
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
        animation: 'slide_from_right',
      }}
    >
      <RootStack.Screen name="Onboarding" component={OnboardingScreen} />
      <RootStack.Screen name="Main" component={MainTabs} />
      <RootStack.Screen name="Capture" component={CaptureScreen} />
      <RootStack.Screen name="DetectionResults" component={DetectionResultsScreen} />
      <RootStack.Screen name="MatchReview" component={MatchReviewScreen} />
      <RootStack.Screen name="ObservationDetail" component={ObservationDetailScreen} />
      <RootStack.Screen name="PackDetails" component={PackDetailScreen} />
      <RootStack.Screen name="Settings" component={SettingsScreen} />
      <RootStack.Screen name="SecuritySettings" component={SecuritySettingsScreen} />
      <RootStack.Screen name="SignIn" component={SignInScreen} />
      <RootStack.Screen name="SelectRole" component={SelectRoleScreen} />
    </RootStack.Navigator>
  );
};
