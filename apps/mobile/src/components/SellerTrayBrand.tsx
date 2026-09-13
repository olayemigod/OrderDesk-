import { StyleSheet, Text, View } from 'react-native';

import { sellerTrayTheme as theme } from '../theme/sellerTrayTheme';

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
      <SellerTrayMark size={size} inverted={inverted} />
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

export function SellerTrayMark({ size = 42, inverted = false }: { size?: number; inverted?: boolean }) {
  const unit = size / 42;
  const trayColor = inverted ? theme.colors.white : theme.colors.navy;

  return (
    <View style={[styles.mark, { width: size, height: size }]}>
      <View
        style={[
          styles.tray,
          {
            left: 3 * unit,
            right: 3 * unit,
            bottom: 2 * unit,
            height: 22 * unit,
            borderRadius: 8 * unit,
            backgroundColor: trayColor,
          },
        ]}
      />
      <View
        style={[
          styles.bubble,
          {
            left: 8 * unit,
            right: 8 * unit,
            bottom: 8 * unit,
            height: 21 * unit,
            borderRadius: 6 * unit,
            backgroundColor: inverted ? theme.colors.mint : theme.colors.mint,
          },
        ]}
      >
        <View
          style={[
            styles.tail,
            {
              width: 7 * unit,
              height: 7 * unit,
              bottom: -3 * unit,
              left: 7 * unit,
              backgroundColor: theme.colors.mint,
            },
          ]}
        />
        <View style={styles.dots}>
          {[0, 1, 2].map((index) => (
            <View
              key={index}
              style={[
                styles.dot,
                {
                  width: 4 * unit,
                  height: 4 * unit,
                  borderRadius: 4 * unit,
                  backgroundColor: theme.colors.green,
                },
              ]}
            />
          ))}
        </View>
      </View>
      <View style={[styles.awning, { height: 15 * unit }]}>
        {[
          theme.colors.green,
          theme.colors.mint,
          theme.colors.green,
          theme.colors.greenDark,
        ].map((color, index) => (
          <View
            key={index}
            style={[
              styles.awningPanel,
              {
                backgroundColor: color,
                borderBottomLeftRadius: 5 * unit,
                borderBottomRightRadius: 5 * unit,
              },
            ]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  lockup: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  copy: { justifyContent: 'center', flexShrink: 1 },
  wordmark: { fontWeight: '900', letterSpacing: -0.8 },
  tagline: { color: theme.colors.slate, fontSize: 9, fontWeight: '700', letterSpacing: 0.35, marginTop: 1 },
  taglineInverted: { color: theme.colors.mint },
  mark: { position: 'relative' },
  tray: { position: 'absolute' },
  bubble: { position: 'absolute', alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  tail: { position: 'absolute', transform: [{ rotate: '45deg' }] },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  dot: {},
  awning: {
    position: 'absolute',
    left: 4,
    right: 4,
    top: 1,
    flexDirection: 'row',
    overflow: 'hidden',
    borderTopLeftRadius: 5,
    borderTopRightRadius: 5,
    zIndex: 3,
  },
  awningPanel: { flex: 1 },
});
