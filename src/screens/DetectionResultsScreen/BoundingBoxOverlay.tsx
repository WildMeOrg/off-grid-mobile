import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import type { Detection } from '../../types/wildlife';
import { useThemedStyles, useTheme } from '../../theme';
import { createStyles } from './styles';

interface BoundingBoxOverlayProps {
  detection: Detection;
  onPress: () => void;
  /** Resolves an approved individual id to a display name (see useIndividualNameResolver). */
  resolveName: (individualId: string | null) => string | null;
}

export const BoundingBoxOverlay: React.FC<BoundingBoxOverlayProps> = ({
  detection,
  onPress,
  resolveName,
}) => {
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const { boundingBox, species, speciesConfidence, id, matchResult } = detection;

  const getBoxColor = (confidence: number): string => {
    if (confidence > 0.8) return colors.statusSuccess;
    if (confidence > 0.5) return colors.statusWarning;
    return colors.statusError;
  };
  const borderColor = getBoxColor(speciesConfidence);
  const isReviewed = matchResult.reviewStatus === 'approved';
  const labelText = isReviewed
    ? resolveName(matchResult.approvedIndividual) ?? species
    : 'Tap to Review';

  return (
    <TouchableOpacity
      testID={`bounding-box-${id}`}
      onPress={onPress}
      activeOpacity={0.7}
      style={[
        styles.boundingBox,
        {
          left: `${boundingBox.x * 100}%`,
          top: `${boundingBox.y * 100}%`,
          width: `${boundingBox.width * 100}%`,
          height: `${boundingBox.height * 100}%`,
          borderColor,
        },
      ]}
    >
      <View style={[styles.boxLabel, { backgroundColor: borderColor }]}>
        {isReviewed ? (
          <Icon
            name="check-circle"
            size={18}
            color="#FFFFFF"
            testID={`box-reviewed-${id}`}
          />
        ) : (
          <Icon
            name="chevron-right"
            size={18}
            color="#FFFFFF"
            testID={`box-tap-hint-${id}`}
          />
        )}
        <Text style={styles.boxLabelText} numberOfLines={2}>
          {labelText}
        </Text>
      </View>
    </TouchableOpacity>
  );
};
