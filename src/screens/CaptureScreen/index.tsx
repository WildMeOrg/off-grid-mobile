import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Feather';
import { useThemedStyles, useTheme } from '../../theme';
import { createStyles } from './styles';
import { useCaptureFlow } from './useCaptureFlow';

export const CaptureScreen: React.FC = () => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { isProcessing, batchProgress, takePhoto, chooseFromGallery } = useCaptureFlow();

  return (
    <SafeAreaView
      style={styles.container}
      testID="capture-screen"
      edges={['top']}
    >
      <View style={styles.content}>
        {isProcessing ? (
          <View style={styles.processingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.processingText}>
              {batchProgress
                ? `Processing ${batchProgress.current} of ${batchProgress.total}...`
                : 'Processing...'}
            </Text>
          </View>
        ) : (
          <>
            <Text style={styles.title}>Capture</Text>
            <Text style={styles.subtitle}>
              Take a photo or choose one from your gallery to identify wildlife.
            </Text>
            <View style={styles.buttonContainer}>
              <TouchableOpacity
                style={[styles.button, isProcessing && styles.buttonDisabled]}
                onPress={takePhoto}
                disabled={isProcessing}
                testID="take-photo-button"
              >
                <Icon name="camera" size={24} color={colors.text} />
                <Text style={styles.buttonText}>Take Photo</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, isProcessing && styles.buttonDisabled]}
                onPress={chooseFromGallery}
                disabled={isProcessing}
                testID="choose-gallery-button"
              >
                <Icon name="image" size={24} color={colors.text} />
                <Text style={styles.buttonText}>Choose from Gallery</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </View>
    </SafeAreaView>
  );
};
