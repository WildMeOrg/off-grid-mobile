import React, { useCallback, useState } from 'react';
import { View, Text, Alert, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/Feather';
import { Button } from '../components/Button';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';
import { entraAuthService } from '../services/entraAuthService';
import { ganeshaApiClient } from '../services/ganeshaApiClient';
import type { RootStackParamList } from '../navigation/types';
import logger from '../utils/logger';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'SignIn'>;

/**
 * Reached only from an action that actually needs connectivity (pack
 * download, sync) via utils/authGate.ensureSignedIn -- never a mandatory
 * app-wide gate, since capture/detection/review must keep working fully
 * offline with no account at all.
 */
export const SignInScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [isSigningIn, setIsSigningIn] = useState(false);

  const handleSignIn = useCallback(async () => {
    setIsSigningIn(true);
    try {
      await entraAuthService.signIn();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('[SignInScreen] Sign-in failed or was cancelled:', message);
      // A cancelled sign-in (user backed out of the browser) is not an
      // error worth alerting about -- only surface a message for real
      // failures the person might be able to act on.
      if (!/cancel/i.test(message)) {
        Alert.alert('Sign-in failed', message);
      }
      setIsSigningIn(false);
      return;
    }

    const profileResult = await ganeshaApiClient.getUserProfile();
    setIsSigningIn(false);

    if (profileResult.ok) {
      if (navigation.canGoBack()) {
        navigation.goBack();
      } else {
        navigation.replace('Main');
      }
      return;
    }

    if (profileResult.code === 'not-found') {
      // First sign-in for this identity -- mirrors the web app's
      // select-role step. Replace, not push, so a later "back" from
      // SelectRole doesn't return to a completed SignIn screen.
      navigation.replace('SelectRole');
      return;
    }

    Alert.alert('Sign-in failed', `Could not load your profile: ${profileResult.message}`);
  }, [navigation]);

  return (
    <SafeAreaView style={styles.container} testID="sign-in-screen" edges={['top']}>
      {navigation.canGoBack() && (
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          testID="sign-in-back-button"
        >
          <Icon name="arrow-left" size={20} color={colors.text} />
        </TouchableOpacity>
      )}

      <View style={styles.content}>
        <Icon name="user-check" size={48} color={colors.primary} />
        <Text style={styles.title}>Sign in required</Text>
        <Text style={styles.subtitle}>
          Downloading the elephant identification pack and syncing field
          observations both need your own Microsoft account. Capturing and
          reviewing sightings still works fully offline without signing in.
        </Text>

        <Button
          title="Sign in with Microsoft"
          onPress={handleSignIn}
          loading={isSigningIn}
          disabled={isSigningIn}
          style={styles.signInButton}
          testID="sign-in-button"
        />
      </View>
    </SafeAreaView>
  );
};

const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  backButton: {
    padding: SPACING.lg,
  },
  content: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    paddingHorizontal: SPACING.xxl,
    gap: SPACING.md,
  },
  title: {
    ...TYPOGRAPHY.h2,
    color: colors.text,
    marginTop: SPACING.sm,
  },
  subtitle: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
    textAlign: 'center' as const,
    lineHeight: 20,
  },
  signInButton: {
    marginTop: SPACING.lg,
    minWidth: 240,
  },
});
