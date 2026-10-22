import { forwardRef } from 'react';
import {
  StyleSheet,
  TextInput as NativeTextInput,
  type TextInputProps,
} from 'react-native';

import { useSellerTrayAppearance } from '../theme/AppearanceContext';
import {
  sellerTrayScaledFontSize,
  sellerTrayScaledLineHeight,
} from '../theme/typography';

export const SellerTrayTextInput = forwardRef<NativeTextInput, TextInputProps>(function SellerTrayTextInput(
  { style, ...props },
  ref,
) {
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

  return <NativeTextInput ref={ref} {...props} style={[style, scaledTypography]} />;
});
