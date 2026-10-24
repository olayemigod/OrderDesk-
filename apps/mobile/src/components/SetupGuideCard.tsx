import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { MerchantBusiness } from '../data/businessRepository';
import { useSellerTrayAppearance } from '../theme/AppearanceContext';

type Props = {
  business: MerchantBusiness;
  productCount: number;
  orderCount: number;
  onProducts: () => void;
  onOrders: () => void;
  onMore: () => void;
};

export function SetupGuideCard({
  business,
  productCount,
  orderCount,
  onProducts,
  onOrders,
  onMore,
}: Props) {
  const appearance = useSellerTrayAppearance();
  const steps = [
    {
      key: 'business',
      title: 'Business details',
      text: 'Confirm your business contact details and operating defaults.',
      done: Boolean(business.name && (business.businessPhone || business.businessEmail)),
      action: onMore,
      icon: 'business-outline',
    },
    {
      key: 'products',
      title: 'Add products',
      text: 'Add the products customers can order and their selling prices.',
      done: productCount > 0,
      action: onProducts,
      icon: 'cube-outline',
    },
    {
      key: 'whatsapp',
      title: 'Connect WhatsApp',
      text: business.whatsappReadiness.messagingReady
        ? 'Inbound and outbound WhatsApp messaging are verified.'
        : 'Connect WhatsApp and verify both inbound and outbound messaging.',
      done: business.whatsappReadiness.messagingReady,
      action: onMore,
      icon: 'logo-whatsapp',
    },
    {
      key: 'order',
      title: 'Create or receive a test order',
      text: 'Create a manual order now or send a WhatsApp test order after connection.',
      done: orderCount > 0,
      action: onOrders,
      icon: 'receipt-outline',
    },
  ];

  const completed = steps.filter((step) => step.done).length;
  const allDone = completed === steps.length;

  return (
    <View style={[styles.card, appearance.dark && darkStyles.card, allDone && styles.doneCard, allDone && appearance.dark && darkStyles.doneCard]}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>{allDone ? 'SETUP COMPLETE' : 'GET STARTED'}</Text>
          <Text style={[styles.title, appearance.dark && darkStyles.titleText]}>{allDone ? 'SellerTray is ready' : 'Finish setting up SellerTray'}</Text>
          <Text style={[styles.subtitle, appearance.dark && darkStyles.bodyText]}>
            {allDone
              ? 'Your core merchant setup is complete.'
              : completed + ' of ' + steps.length + ' setup steps completed'}
          </Text>
        </View>
        <View style={styles.progressBadge}>
          <Text style={styles.progressText}>{completed}/{steps.length}</Text>
        </View>
      </View>

      {!allDone ? (
        <View style={styles.steps}>
          {steps.map((step, index) => (
            <Pressable
              key={step.key}
              disabled={step.done}
              onPress={step.action}
              style={({ pressed }) => [styles.step, appearance.dark && darkStyles.step, step.done && styles.stepDone, pressed && styles.pressed]}
            >
              <View style={[styles.stepNumber, step.done && styles.stepNumberDone, appearance.dark && darkStyles.iconWrap]}>
                <Ionicons
                  name={step.done ? 'checkmark' : step.icon as never}
                  size={18}
                  color={step.done ? '#027A48' : '#079455'}
                />
              </View>
              <View style={styles.stepCopy}>
                <Text style={[styles.stepTitle, appearance.dark && darkStyles.titleText, step.done && styles.stepTitleDone]}>{step.title}</Text>
                <Text style={[styles.stepText, appearance.dark && darkStyles.bodyText]}>{step.text}</Text>
              </View>
              {!step.done ? <Text style={styles.chevron}>›</Text> : null}
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#ABEFC6',
    borderRadius: 18,
    padding: 15,
    gap: 13,
  },
  doneCard: { borderColor: '#ABEFC6', backgroundColor: '#F6FEF9' },
  header: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  headerCopy: { flex: 1 },
  eyebrow: { color: '#12B76A', fontSize: 12, fontWeight: '900', letterSpacing: 1.1 },
  title: { color: '#102A43', fontSize: 19, fontWeight: '900', marginTop: 3 },
  subtitle: { color: '#667085', fontSize: 13, lineHeight: 19, marginTop: 3 },
  progressBadge: { minWidth: 42, borderRadius: 999, backgroundColor: '#ECFDF3', paddingHorizontal: 9, paddingVertical: 6, alignItems: 'center' },
  progressText: { color: '#079455', fontSize: 12, fontWeight: '900' },
  steps: { gap: 7 },
  step: {
    minHeight: 62,
    borderRadius: 13,
    backgroundColor: '#F9FAFB',
    padding: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  stepDone: { opacity: 0.62 },
  stepNumber: { width: 30, height: 30, borderRadius: 99, backgroundColor: '#ECFDF3', alignItems: 'center', justifyContent: 'center' },
  stepNumberDone: { backgroundColor: '#ECFDF3' },
  stepNumberText: { color: '#079455', fontSize: 13, fontWeight: '900' },
  stepNumberTextDone: { color: '#027A48' },
  stepCopy: { flex: 1 },
  stepTitle: { color: '#102A43', fontSize: 13, fontWeight: '900' },
  stepTitleDone: { color: '#475467' },
  stepText: { color: '#667085', fontSize: 12, lineHeight: 18, marginTop: 2 },
  chevron: { color: '#667085', fontSize: 24 },
  pressed: { opacity: 0.75 },
});

const darkStyles = StyleSheet.create({
  card: { backgroundColor: '#102A43', borderColor: '#1C6B4A' },
  doneCard: { backgroundColor: '#12372C' },
  step: { backgroundColor: '#162F46' },
  iconWrap: { backgroundColor: '#12372C' },
  titleText: { color: '#F8FAFC' },
  bodyText: { color: '#D0D5DD' },
});
