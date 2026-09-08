import type { MerchantOrder } from '../domain/order';

export const demoOrders: MerchantOrder[] = [
  {
    id: 'OD-1003',
    customerName: 'Amina Yusuf',
    customerPhone: '+234 803 555 0142',
    receivedAt: '2026-09-08T15:38:00+01:00',
    status: 'needs_review',
    source: 'whatsapp',
    customerMessage: 'Please send 2 bags of 5kg rice and 1 vegetable oil. Same address as last time.',
    confidence: 0.92,
    items: [
      { id: '1', name: '5kg Rice', quantity: 2, unitPrice: 8500 },
      { id: '2', name: 'Vegetable Oil', quantity: 1, unitPrice: 5200 },
    ],
  },
  {
    id: 'OD-1002',
    customerName: 'Tunde Bello',
    customerPhone: '+234 805 444 2180',
    receivedAt: '2026-09-08T15:21:00+01:00',
    status: 'accepted',
    source: 'whatsapp',
    customerMessage: 'I need 3 cartons of bottled water.',
    confidence: 0.97,
    items: [{ id: '3', name: 'Bottled Water - Carton', quantity: 3, unitPrice: 3800 }],
  },
  {
    id: 'OD-1001',
    customerName: 'Chidinma Okeke',
    customerPhone: '+234 807 220 7711',
    receivedAt: '2026-09-08T14:50:00+01:00',
    status: 'processing',
    source: 'whatsapp',
    customerMessage: 'One crate malt and two packs tissue please.',
    confidence: 0.88,
    items: [
      { id: '4', name: 'Malt - Crate', quantity: 1, unitPrice: 7600 },
      { id: '5', name: 'Tissue - Pack', quantity: 2, unitPrice: 2100 },
    ],
  },
];
