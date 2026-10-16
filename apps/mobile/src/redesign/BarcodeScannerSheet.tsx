import { useEffect, useState } from 'react';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { Alert, AppState, Linking, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { sellerTrayTheme as theme } from '../theme/sellerTrayTheme';

const RETAIL_BARCODE_TYPES = ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'itf14'] as const;

type Props = {
  visible: boolean;
  onClose: () => void;
  onBarcode: (barcode: string) => void;
};

export function BarcodeScannerSheet({ visible, onClose, onBarcode }: Props) {
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const [locked, setLocked] = useState(false);
  const [manualBarcode, setManualBarcode] = useState('');
  const [requestingPermission, setRequestingPermission] = useState(false);

  useEffect(() => {
    if (!visible) return;
    void getPermission();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void getPermission();
    });
    return () => subscription.remove();
  }, [getPermission, visible]);

  function close() {
    setLocked(false);
    setManualBarcode('');
    onClose();
  }

  function chooseBarcode(raw: string) {
    const barcode = raw.trim();
    if (!barcode || locked) return;
    setLocked(true);
    onBarcode(barcode);
  }

  function scanned(result: BarcodeScanningResult) {
    chooseBarcode(result.data);
  }

  async function requestCameraAccess() {
    if (requestingPermission || permission?.granted) return;
    setRequestingPermission(true);
    try {
      if (permission?.canAskAgain === false) {
        await Linking.openSettings();
        return;
      }
      const next = await requestPermission();
      if (!next.granted && !next.canAskAgain) {
        Alert.alert(
          'Camera permission needed',
          'Enable Camera for SellerTray in your device settings to scan product barcodes.',
          [
            { text: 'Not now', style: 'cancel' },
            { text: 'Open settings', onPress: () => void Linking.openSettings() },
          ],
        );
      }
    } catch (error) {
      Alert.alert(
        'Unable to request camera access',
        error instanceof Error ? error.message : 'Open your device settings and allow Camera for SellerTray.',
      );
    } finally {
      setRequestingPermission(false);
    }
  }

  const needsSettings = permission?.canAskAgain === false;

  return <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={close}>
    <View style={styles.screen}>
      <View style={styles.header}>
        <View><Text style={styles.eyebrow}>Product barcode</Text><Text style={styles.title}>Scan barcode</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel="Close barcode scanner" onPress={close} style={styles.closeButton}>
          <Ionicons name="close" size={24} color={theme.colors.navy} />
        </Pressable>
      </View>

      <Text style={styles.help}>Point the camera at the product barcode. SellerTray will look for the exact product and unit before offering to add anything new.</Text>

      {!permission ? <View style={styles.cameraPlaceholder}><Text style={styles.muted}>Checking camera access…</Text></View> : null}
      {permission && !permission.granted ? <View style={styles.permissionCard}>
        <Ionicons name="camera-outline" size={30} color={theme.colors.greenDark} />
        <Text style={styles.permissionTitle}>Camera access is needed to scan</Text>
        <Text style={styles.muted}>{needsSettings
          ? 'Camera access is turned off in your device settings. Open Settings to allow SellerTray to use the camera.'
          : 'You can still enter the barcode below if you prefer not to use the camera.'}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={needsSettings ? 'Open SellerTray camera settings' : 'Allow SellerTray camera access'}
          disabled={requestingPermission}
          onPress={() => void requestCameraAccess()}
          style={[styles.primaryButton, requestingPermission && styles.disabled]}
        >
          <Text style={styles.primaryText}>{requestingPermission ? 'Requesting…' : needsSettings ? 'Open camera settings' : 'Allow camera'}</Text>
        </Pressable>
      </View> : null}
      {permission?.granted ? <View style={styles.cameraFrame}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          active={visible && !locked}
          onBarcodeScanned={locked ? undefined : scanned}
          barcodeScannerSettings={{ barcodeTypes: [...RETAIL_BARCODE_TYPES] }}
        />
        <View pointerEvents="none" style={styles.scanGuide}><View style={styles.scanWindow} /></View>
        {locked ? <View style={styles.lockedOverlay}><Text style={styles.lockedText}>Barcode captured…</Text></View> : null}
      </View> : null}

      <View style={styles.manualCard}>
        <Text style={styles.label}>Enter barcode instead</Text>
        <View style={styles.manualRow}>
          <TextInput
            value={manualBarcode}
            onChangeText={setManualBarcode}
            keyboardType="number-pad"
            autoCorrect={false}
            autoCapitalize="none"
            placeholder="Enter barcode number"
            placeholderTextColor={theme.colors.subtle}
            style={styles.input}
          />
          <Pressable disabled={!manualBarcode.trim() || locked} onPress={() => chooseBarcode(manualBarcode)} style={[styles.useButton, (!manualBarcode.trim() || locked) && styles.disabled]}>
            <Text style={styles.useText}>Use</Text>
          </Pressable>
        </View>
      </View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.cloud, paddingHorizontal: 18, paddingTop: 52, paddingBottom: 24, gap: 16 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  eyebrow: { color: theme.colors.muted, fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  title: { color: theme.colors.navy, fontSize: 27, fontWeight: '900' },
  closeButton: { width: 44, height: 44, borderRadius: 14, backgroundColor: theme.colors.white, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.colors.border },
  help: { color: theme.colors.slate, fontSize: 14, lineHeight: 20 },
  cameraPlaceholder: { flex: 1, minHeight: 280, borderRadius: 22, backgroundColor: theme.colors.navy, alignItems: 'center', justifyContent: 'center' },
  cameraFrame: { flex: 1, minHeight: 320, overflow: 'hidden', borderRadius: 22, backgroundColor: theme.colors.navy },
  scanGuide: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
  scanWindow: { width: '82%', height: 150, borderWidth: 2, borderColor: theme.colors.white, borderRadius: 18 },
  lockedOverlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(16,42,67,0.62)', alignItems: 'center', justifyContent: 'center' },
  lockedText: { color: theme.colors.white, fontWeight: '900', fontSize: 16 },
  permissionCard: { flex: 1, minHeight: 280, borderRadius: 22, backgroundColor: theme.colors.white, borderWidth: 1, borderColor: theme.colors.border, padding: 24, alignItems: 'center', justifyContent: 'center', gap: 12 },
  permissionTitle: { color: theme.colors.navy, fontSize: 17, fontWeight: '900', textAlign: 'center' },
  muted: { color: theme.colors.muted, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  primaryButton: { minHeight: 46, paddingHorizontal: 20, borderRadius: 14, backgroundColor: theme.colors.green, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: theme.colors.white, fontWeight: '900' },
  manualCard: { backgroundColor: theme.colors.white, borderRadius: 18, borderWidth: 1, borderColor: theme.colors.border, padding: 14, gap: 8 },
  label: { color: theme.colors.navy, fontSize: 12, fontWeight: '900' },
  manualRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { flex: 1, minHeight: 48, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 13, paddingHorizontal: 12, color: theme.colors.navy, fontSize: 15 },
  useButton: { minHeight: 48, paddingHorizontal: 18, borderRadius: 13, backgroundColor: theme.colors.greenDark, alignItems: 'center', justifyContent: 'center' },
  useText: { color: theme.colors.white, fontWeight: '900' },
  disabled: { opacity: 0.45 },
});
