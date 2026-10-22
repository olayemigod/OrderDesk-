import { Image, StyleSheet, Text, View } from 'react-native';

import { sellerTrayTheme as theme } from '../theme/sellerTrayTheme';

const SELLERTRAY_ADMIN_LOGO = require('../../assets/sellertray-admin-logo.webp');

type BrandMarkProps = {
  size?: number;
  showWordmark?: boolean;
  showTagline?: boolean;
  inverted?: boolean;
};

export function SellerTrayBrand({
  size = 42,
  showWordmark = true,
  showTagline = false,
  inverted = false,
}: BrandMarkProps) {
  const sellerColor = inverted ? theme.colors.white : theme.colors.navy;

  return (
    <View style={styles.lockup}>
      <SellerTrayMark size={size} />
      {showWordmark ? (
        <View style={styles.copy}>
          <Text style={[styles.wordmark, { fontSize: Math.max(18, size * 0.58) }]}>
            <Text style={{ color: sellerColor }}>Seller</Text>
            <Text style={{ color: theme.colors.green }}>Tray</Text>
          </Text>
          {showTagline ? (
            <Text style={[styles.tagline, inverted && styles.taglineInverted]}>
              Orders. Conversations. Growth.
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export function SellerTrayMark({ size = 42 }: { size?: number; inverted?: boolean }) {
  return (
    <Image
      source={SELLERTRAY_ADMIN_LOGO}
      accessibilityIgnoresInvertColors
      resizeMode="contain"
      style={{ width: size, height: size }}
    />
  );
}

const styles = StyleSheet.create({
  lockup: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  copy: { justifyContent: 'center', flexShrink: 1 },
  wordmark: { fontWeight: '900', letterSpacing: -0.8 },
  tagline: { color: theme.colors.slate, fontSize: 9, fontWeight: '700', letterSpacing: 0.35, marginTop: 1 },
  taglineInverted: { color: theme.colors.mint },
});
