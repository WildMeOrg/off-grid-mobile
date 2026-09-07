import React from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Switch,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Feather';
import { useNavigation, CommonActions } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import DeviceInfo from 'react-native-device-info';
import { Card } from '../components';
import { AnimatedEntry } from '../components/AnimatedEntry';
import { AnimatedListItem } from '../components/AnimatedListItem';
import { useFocusTrigger } from '../hooks/useFocusTrigger';
import { useTheme, useThemedStyles } from '../theme';
import { useAppStore, useWildlifeStore } from '../stores';
import { SettingsStackParamList } from '../navigation/types';
import { createStyles } from './SettingsScreen.styles';

type NavigationProp = NativeStackNavigationProp<SettingsStackParamList, 'SettingsMain'>;

export const SettingsScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const focusTrigger = useFocusTrigger();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const setOnboardingComplete = useAppStore((s) => s.setOnboardingComplete);
  const themeMode = useAppStore((s) => s.themeMode);
  const setThemeMode = useAppStore((s) => s.setThemeMode);
  const preferGpuModel = useAppStore((s) => s.preferGpuModel);
  const setPreferGpuModel = useAppStore((s) => s.setPreferGpuModel);
  const miewidModel = useWildlifeStore((s) => s.miewidModel);
  const packs = useWildlifeStore((s) => s.packs);

  const handleResetOnboarding = () => {
    setOnboardingComplete(false);
    // Navigate to root stack and reset to Onboarding
    navigation.getParent()?.getParent()?.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [{ name: 'Onboarding' }],
      })
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Settings</Text>
      </View>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>

        {/* Theme Selector */}
        <AnimatedEntry index={0} staggerMs={40} trigger={focusTrigger}>
          <View style={styles.themeToggleRow}>
            <Text style={styles.themeToggleLabel}>Appearance</Text>
            <View style={styles.themeSelector}>
              {([
                { mode: 'system' as const, icon: 'monitor' },
                { mode: 'light' as const, icon: 'sun' },
                { mode: 'dark' as const, icon: 'moon' },
              ]).map(({ mode, icon }) => (
                <TouchableOpacity
                  key={mode}
                  style={[
                    styles.themeSelectorOption,
                    themeMode === mode && styles.themeSelectorOptionActive,
                  ]}
                  onPress={() => setThemeMode(mode)}
                >
                  <Icon
                    name={icon}
                    size={16}
                    color={themeMode === mode ? colors.background : colors.textMuted}
                  />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </AnimatedEntry>

        {/* Navigation Items */}
        <View style={styles.navSection}>
          {[
            { icon: 'lock', title: 'Security', desc: 'Passphrase and app lock', screen: 'SecuritySettings' as const },
          ].map((item, index, arr) => (
            <AnimatedListItem
              key={item.screen}
              index={index + 1}
              staggerMs={40}
              trigger={focusTrigger}
              style={[styles.navItem, index === arr.length - 1 && styles.navItemLast]}
              onPress={() => navigation.navigate(item.screen)}
            >
              <View style={styles.navItemIcon}>
                <Icon name={item.icon} size={16} color={colors.textSecondary} />
              </View>
              <View style={styles.navItemContent}>
                <Text style={styles.navItemTitle}>{item.title}</Text>
                <Text style={styles.navItemDesc}>{item.desc}</Text>
              </View>
              <Icon name="chevron-right" size={16} color={colors.textMuted} />
            </AnimatedListItem>
          ))}
        </View>

        {/* About */}
        <AnimatedEntry index={2} staggerMs={40} trigger={focusTrigger}>
          <Card style={styles.section}>
            <View style={styles.aboutRow}>
              <Text style={styles.aboutLabel}>App version</Text>
              <Text style={styles.aboutValue}>
                {DeviceInfo.getVersion()} ({DeviceInfo.getBuildNumber()})
              </Text>
            </View>
            <View style={styles.aboutRow}>
              <Text style={styles.aboutLabel}>MiewID model</Text>
              <Text style={styles.aboutValue}>
                {miewidModel?.version ?? 'Not installed'}
              </Text>
            </View>
            {Platform.OS === 'android' && (
              <View style={styles.gpuToggleRow}>
                <View style={styles.gpuToggleInfo}>
                  <Text style={styles.aboutLabel}>GPU acceleration</Text>
                  <Text style={styles.gpuToggleHint}>
                    Experimental -- uses the phone's GPU for faster
                    identification when available, and falls back
                    automatically when it isn't. Re-download the model
                    afterward for this to take effect.
                  </Text>
                </View>
                <Switch
                  value={preferGpuModel}
                  onValueChange={setPreferGpuModel}
                  trackColor={{ false: colors.surfaceLight, true: `${colors.primary}80` }}
                  thumbColor={preferGpuModel ? colors.primary : colors.textMuted}
                  testID="gpu-acceleration-toggle"
                />
              </View>
            )}
            {packs.length === 0 ? (
              <View style={styles.aboutRow}>
                <Text style={styles.aboutLabel}>Embedding pack</Text>
                <Text style={styles.aboutValue}>Not installed</Text>
              </View>
            ) : (
              packs.map((pack) => (
                <View key={pack.id} style={styles.aboutRow}>
                  <Text style={styles.aboutLabel}>{pack.displayName}</Text>
                  <Text style={styles.aboutValue}>{pack.packVersion}</Text>
                </View>
              ))
            )}
            <Text style={styles.aboutText}>
              EleBook helps identify elephants in the field using on-device
              AI, so it works fully offline -- no network connection needed
              to capture, detect, or match a sighting.
            </Text>
          </Card>
        </AnimatedEntry>

        {/* Privacy */}
        <AnimatedEntry index={3} staggerMs={40} trigger={focusTrigger}>
          <Card style={styles.privacyCard}>
            <View style={styles.privacyIconContainer}>
              <Icon name="shield" size={18} color={colors.textSecondary} />
            </View>
            <Text style={styles.privacyTitle}>Privacy First</Text>
            <Text style={styles.privacyText}>
              Photos and observations are captured and matched entirely on
              this device. They are only uploaded to the Ganesha project
              backend when you sign in and sync -- nothing is sent
              automatically or in the background.
            </Text>
          </Card>
        </AnimatedEntry>

        {/* Dev-only: Reset Onboarding */}
        {__DEV__ && (
          <AnimatedEntry index={4} staggerMs={40} trigger={focusTrigger}>
            <TouchableOpacity style={styles.devButton} onPress={handleResetOnboarding}>
              <Icon name="rotate-ccw" size={14} color={colors.textMuted} />
              <Text style={styles.devButtonText}>Reset Onboarding</Text>
            </TouchableOpacity>
          </AnimatedEntry>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};
