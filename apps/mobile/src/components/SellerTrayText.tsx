import { StyleSheet, Text as NativeText, type TextProps } from 'react-native';

import { useSellerTrayAppearance } from '../theme/AppearanceContext';

export function SellerTrayText({ style, ...props }: TextProps) {
  const { fontScale } = useSellerTrayAppearance();
  const flatStyle = StyleSheet.flatten(style);
  const scaledTypography = fontScale === 1
    ? null
    : {
        ...(typeof flatStyle?.fontSize === 'number'
          ? { fontSize: Number((flatStyle.fontSize * fontScale).toFixed(2)) }
          : {}),
        ...(typeof flatStyle?.lineHeight === 'number'
          ? { lineHeight: Number((flatStyle.lineHeight * fontScale).toFixed(2)) }
          : {}),
      };

  return <NativeText {...props} style={[style, scaledTypography]} />;
}
