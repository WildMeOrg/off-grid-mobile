import React from 'react';
import { Text, View } from 'react-native';
import type { ViewStyle } from 'react-native';
import { useThemedStyles } from '../theme/useThemedStyles';
import { createStyles } from './PacksScreen.styles';
import {
  KEEP_APP_OPEN_HINT,
  describeDownloadAmount,
  describeDownloadStage,
} from './packDownloadProgress';
import type { DownloadProgress } from './packDownloadProgress';

interface PackDownloadStatusProps {
  progress: DownloadProgress | null;
  style?: ViewStyle;
}

export const PackDownloadStatus: React.FC<PackDownloadStatusProps> = ({
  progress,
  style,
}) => {
  const styles = useThemedStyles(createStyles);
  const amount = describeDownloadAmount(progress);
  return (
    <View style={style} testID="pack-download-status">
      <Text style={styles.updateStatus} accessibilityLiveRegion="polite">
        {describeDownloadStage(progress)}
      </Text>
      {amount ? (
        <Text style={styles.downloadDetail} testID="pack-download-amount">
          {amount}
        </Text>
      ) : null}
      <Text style={styles.downloadDetail}>{KEEP_APP_OPEN_HINT}</Text>
    </View>
  );
};
