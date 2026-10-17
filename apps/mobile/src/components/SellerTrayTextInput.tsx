import { forwardRef } from 'react';
import {
  StyleSheet,
  TextInput as NativeTextInput,
  type TextInputProps,
} from 'react-native';

import { useSellerTrayAppearance } from '../theme/AppearanceContext';

export const SellerTrayTextInput = forwardRef<NativeTextInput, TextInputProps>(function SellerTrayTextInput(
  { style, ...props },
  ref,
) {
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

  return <NativeTextInput ref={ref} {...props} style={[style, scaledTypography]} />;
});
