import React, { useCallback, useState } from 'react';
import { View, Text, TextInput, Alert, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/Feather';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';
import { ganeshaApiClient } from '../services/ganeshaApiClient';
import type { RootStackParamList } from '../navigation/types';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'SelectRole'>;

/**
 * First-sign-in-only step, reached from SignInScreen when GET /users/profile
 * comes back 404. The backend assigns organization and access from the
 * authenticated Microsoft identity; the client only supplies a display name.
 */
export const SelectRoleScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [name, setName] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const handleCompleteProfile = useCallback(
    async () => {
      const trimmedName = name.trim();
      if (!trimmedName) {
        Alert.alert('Name required', 'Please enter your name first.');
        return;
      }

      setIsSaving(true);
      const result = await ganeshaApiClient.createUserProfile({
        name: trimmedName,
      });
      setIsSaving(false);

      if (!result.ok) {
        Alert.alert('Could not save your profile', result.message);
        return;
      }

      navigation.replace('Main');
    },
    [name, navigation],
  );

  return (
    <SafeAreaView style={styles.container} testID="select-role-screen" edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Complete Your Profile</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Text style={styles.subtitle}>
          Your access is assigned from your Microsoft account.
        </Text>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Your name</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Enter your name"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="words"
            testID="select-role-name-input"
          />
        </View>

        <Card style={styles.profileCard}>
          <Button
            title="Continue"
            variant="primary"
            onPress={handleCompleteProfile}
            loading={isSaving}
            disabled={isSaving}
            icon={<Icon name="user-check" size={16} color={colors.background} />}
            testID="complete-profile-button"
          />
        </Card>

        <Text style={styles.footnote}>
          Approved field researchers receive researcher access automatically.
        </Text>
        </KeyboardAvoidingView>
      </ScrollView>
    </SafeAreaView>
  );
};

const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
    ...shadows.small,
  },
  title: {
    ...TYPOGRAPHY.h2,
    color: colors.text,
  },
  content: {
    padding: SPACING.lg,
  },
  subtitle: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
    textAlign: 'center' as const,
    marginBottom: SPACING.lg,
  },
  inputGroup: {
    marginBottom: SPACING.lg,
  },
  inputLabel: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.text,
    marginBottom: SPACING.sm,
  },
  input: {
    ...TYPOGRAPHY.body,
    backgroundColor: colors.surfaceLight,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: SPACING.md,
    color: colors.text,
  },
  profileCard: {
    marginBottom: SPACING.md,
  },
  footnote: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
    textAlign: 'center' as const,
    marginTop: SPACING.lg,
  },
});
