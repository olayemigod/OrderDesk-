import { StyleSheet, Text as NativeText, type TextProps } from 'react-native';

import { useSellerTrayAppearance } from '../theme/AppearanceContext';
import {
  sellerTrayScaledFontSize,
  sellerTrayScaledLineHeight,
} from '../theme/typography';

export function SellerTrayText({ style, ...props }: TextProps) {
  const { fontScale } = useSellerTrayAppearance();
  const flatStyle = StyleSheet.flatten(style);
  const scaledFontSize = typeof flatStyle?.fontSize === 'number'
    ? sellerTrayScaledFontSize(flatStyle.fontSize, fontScale)
    : null;
  const scaledLineHeight = typeof flatStyle?.lineHeight === 'number'
    ? sellerTrayScaledLineHeight(flatStyle.lineHeight, fontScale, scaledFontSize ?? 0)
    : null;
  const scaledTypography = scaledFontSize === null && scaledLineHeight === null
    ? null
    : {
        ...(scaledFontSize !== null ? { fontSize: scaledFontSize } : {}),
        ...(scaledLineHeight !== null ? { lineHeight: scaledLineHeight } : {}),
      };

  return <NativeText {...props} style={[style, scaledTypography]} />;
}
