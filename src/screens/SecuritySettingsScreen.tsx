import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Switch,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Feather';
import { Button } from '../components/Button';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Card } from '../components';
import { CustomAlert, showAlert, hideAlert, AlertState, initialAlertState } from '../components/CustomAlert';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';
import { useAuthStore } from '../stores';
import { authService } from '../services';
import { entraAuthService } from '../services/entraAuthService';
import type { RootStackParamList } from '../navigation/types';
import { PassphraseSetupScreen } from './PassphraseSetupScreen';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

export const SecuritySettingsScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const [showPassphraseSetup, setShowPassphraseSetup] = useState(false);
  const [isChangingPassphrase, setIsChangingPassphrase] = useState(false);
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);
  const [isSignedIn, setIsSignedIn] = useState<boolean | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  const {
    isEnabled: authEnabled,
    setEnabled: setAuthEnabled,
  } = useAuthStore();

  useEffect(() => {
    entraAuthService.isSignedIn().then(setIsSignedIn);
  }, []);

  const handleSignOut = () => {
    setAlertState(showAlert(
      'Sign Out',
      'You will need to sign in again to download packs or sync observations.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            setAlertState(hideAlert());
            setIsSigningOut(true);
            await entraAuthService.signOut();
            setIsSignedIn(false);
            setIsSigningOut(false);
          },
        },
      ],
    ));
  };

  const handleTogglePassphrase = async () => {
    if (authEnabled) {
      setAlertState(showAlert(
        'Disable Passphrase Lock',
        'Are you sure you want to disable passphrase protection?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Disable',
            style: 'destructive',
            onPress: async () => {
              setAlertState(hideAlert());
              await authService.removePassphrase();
              setAuthEnabled(false);
            },
          },
        ]
      ));
    } else {
      setIsChangingPassphrase(false);
      setShowPassphraseSetup(true);
    }
  };

  const handleChangePassphrase = () => {
    setIsChangingPassphrase(true);
    setShowPassphraseSetup(true);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Icon name="arrow-left" size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Security</Text>
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Account</Text>
          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel} testID="account-status-label">
                {isSignedIn === null ? 'Checking...' : isSignedIn ? 'Signed in' : 'Not signed in'}
              </Text>
              <Text style={styles.settingHint}>
                Needed to download packs and sync field observations
              </Text>
            </View>
            {isSignedIn ? (
              <Button
                title="Sign Out"
                variant="outline"
                size="small"
                onPress={handleSignOut}
                loading={isSigningOut}
                disabled={isSigningOut}
                testID="account-sign-out-button"
              />
            ) : (
              <Button
                title="Sign In"
                variant="primary"
                size="small"
                onPress={() => navigation.navigate('SignIn')}
                disabled={isSignedIn === null}
                testID="account-sign-in-button"
              />
            )}
          </View>
        </Card>

        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>App Lock</Text>
          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={styles.settingLabel}>Passphrase Lock</Text>
              <Text style={styles.settingHint}>Require passphrase to open app</Text>
            </View>
            <Switch
              value={authEnabled}
              onValueChange={handleTogglePassphrase}
              trackColor={{ false: colors.surfaceLight, true: `${colors.primary  }80` }}
              thumbColor={authEnabled ? colors.primary : colors.textMuted}
            />
          </View>

          {authEnabled && (
            <Button
              title="Change Passphrase"
              variant="primary"
              size="medium"
              onPress={handleChangePassphrase}
              icon={<Icon name="edit-2" size={16} color={colors.primary} />}
              style={{ alignSelf: 'flex-start' as const, marginTop: SPACING.lg }}
            />
          )}
        </Card>

        <Card style={styles.infoCard}>
          <Icon name="info" size={18} color={colors.textMuted} />
          <Text style={styles.infoText}>
            When enabled, the app will lock automatically when you switch away or close it. Your passphrase is stored securely on device and never transmitted.
          </Text>
        </Card>
      </ScrollView>

      <Modal
        visible={showPassphraseSetup}
        animationType="slide"
        onRequestClose={() => setShowPassphraseSetup(false)}
      >
        <PassphraseSetupScreen
          isChanging={isChangingPassphrase}
          onComplete={() => setShowPassphraseSetup(false)}
          onCancel={() => setShowPassphraseSetup(false)}
        />
      </Modal>
      <CustomAlert
        visible={alertState.visible}
        title={alertState.title}
        message={alertState.message}
        buttons={alertState.buttons}
        onClose={() => setAlertState(hideAlert())}
      />
    </SafeAreaView>
  );
};

const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
    ...shadows.small,
    zIndex: 1,
    gap: SPACING.md,
  },
  backButton: {
    padding: SPACING.xs,
  },
  title: {
    ...TYPOGRAPHY.h2,
    flex: 1,
    color: colors.text,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.xxl,
  },
  section: {
    marginBottom: SPACING.lg,
  },
  sectionTitle: {
    ...TYPOGRAPHY.label,
    textTransform: 'uppercase' as const,
    color: colors.textMuted,
    marginBottom: SPACING.md,
    letterSpacing: 0.3,
  },
  settingRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
  },
  settingInfo: {
    flex: 1,
  },
  settingLabel: {
    ...TYPOGRAPHY.body,
    color: colors.text,
  },
  settingHint: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textMuted,
    marginTop: 2,
    lineHeight: 18,
  },
  infoCard: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: SPACING.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  infoText: {
    ...TYPOGRAPHY.bodySmall,
    flex: 1,
    color: colors.textMuted,
    lineHeight: 18,
  },
});
