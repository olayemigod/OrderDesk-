import { ActivityIndicator, SafeAreaView, StyleSheet, Text, View } from 'react-native';

import { SellerTrayBrand } from './SellerTrayBrand';

export function SellerTrayLoadingScreen({ message = 'Loading SellerTray…' }: { message?: string }) {
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.content}>
        <SellerTrayBrand size={62} inverted />
        <ActivityIndicator size="large" color="#D9FBE8" />
        <Text style={styles.message}>{message}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#102A43' },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
    paddingHorizontal: 28,
  },
  message: {
    color: '#F8FAFC',
    fontSize: 18,
    lineHeight: 26,
    fontWeight: '800',
    textAlign: 'center',
  },
});
