import { StyleSheet, Text as NativeText, type TextProps } from 'react-native';

import { useSellerTrayAppearance } from '../theme/AppearanceContext';

const MIN_READABLE_FONT_SIZE = 12;

export function SellerTrayText({ style, ...props }: TextProps) {
  const { fontScale } = useSellerTrayAppearance();
  const flatStyle = StyleSheet.flatten(style);
  const scaledFontSize = typeof flatStyle?.fontSize === 'number'
    ? Math.max(MIN_READABLE_FONT_SIZE, Number((flatStyle.fontSize * fontScale).toFixed(2)))
    : null;
  const scaledLineHeight = typeof flatStyle?.lineHeight === 'number'
    ? Math.max(scaledFontSize ?? 0, Number((flatStyle.lineHeight * fontScale).toFixed(2)))
    : null;
  const scaledTypography = scaledFontSize === null && scaledLineHeight === null
    ? null
    : {
        ...(scaledFontSize !== null ? { fontSize: scaledFontSize } : {}),
        ...(scaledLineHeight !== null ? { lineHeight: scaledLineHeight } : {}),
      };

  return <NativeText {...props} style={[style, scaledTypography]} />;
}
