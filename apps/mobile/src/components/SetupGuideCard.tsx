import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { MerchantBusiness } from '../data/businessRepository';

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
  const steps = [
    {
      key: 'business',
      title: 'Business details',
      text: 'Confirm your business contact details and operating defaults.',
      done: Boolean(business.name && (business.businessPhone || business.businessEmail)),
      action: onMore,
    },
    {
      key: 'products',
      title: 'Add products',
      text: 'Add the products customers can order and their selling prices.',
      done: productCount > 0,
      action: onProducts,
    },
    {
      key: 'whatsapp',
      title: 'Connect WhatsApp',
      text: 'Link your WhatsApp Business number when Meta activation is available.',
      done: business.whatsappConnectionStatus === 'connected',
      action: onMore,
    },
    {
      key: 'order',
      title: 'Create or receive a test order',
      text: 'Create a manual order now or send a WhatsApp test order after connection.',
      done: orderCount > 0,
      action: onOrders,
    },
  ];

  const completed = steps.filter((step) => step.done).length;
  const allDone = completed === steps.length;

  return (
    <View style={[styles.card, allDone && styles.doneCard]}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>{allDone ? 'SETUP COMPLETE' : 'GET STARTED'}</Text>
          <Text style={styles.title}>{allDone ? 'SellerTray is ready' : 'Finish setting up SellerTray'}</Text>
          <Text style={styles.subtitle}>
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
              style={({ pressed }) => [styles.step, step.done && styles.stepDone, pressed && styles.pressed]}
            >
              <View style={[styles.stepNumber, step.done && styles.stepNumberDone]}>
                <Text style={[styles.stepNumberText, step.done && styles.stepNumberTextDone]}>
                  {step.done ? '✓' : index + 1}
                </Text>
              </View>
              <View style={styles.stepCopy}>
                <Text style={[styles.stepTitle, step.done && styles.stepTitleDone]}>{step.title}</Text>
                <Text style={styles.stepText}>{step.text}</Text>
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
    borderColor: '#B2CCFF',
    borderRadius: 18,
    padding: 15,
    gap: 13,
  },
  doneCard: { borderColor: '#ABEFC6', backgroundColor: '#F6FEF9' },
  header: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  headerCopy: { flex: 1 },
  eyebrow: { color: '#246BFD', fontSize: 9, fontWeight: '900', letterSpacing: 1.1 },
  title: { color: '#101828', fontSize: 17, fontWeight: '900', marginTop: 3 },
  subtitle: { color: '#667085', fontSize: 11, lineHeight: 16, marginTop: 3 },
  progressBadge: { minWidth: 42, borderRadius: 999, backgroundColor: '#EEF4FF', paddingHorizontal: 9, paddingVertical: 6, alignItems: 'center' },
  progressText: { color: '#175CD3', fontSize: 10, fontWeight: '900' },
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
  stepNumber: { width: 30, height: 30, borderRadius: 99, backgroundColor: '#EEF4FF', alignItems: 'center', justifyContent: 'center' },
  stepNumberDone: { backgroundColor: '#ECFDF3' },
  stepNumberText: { color: '#175CD3', fontSize: 11, fontWeight: '900' },
  stepNumberTextDone: { color: '#027A48' },
  stepCopy: { flex: 1 },
  stepTitle: { color: '#101828', fontSize: 12, fontWeight: '900' },
  stepTitleDone: { color: '#475467' },
  stepText: { color: '#667085', fontSize: 10, lineHeight: 15, marginTop: 2 },
  chevron: { color: '#98A2B3', fontSize: 24 },
  pressed: { opacity: 0.75 },
});
