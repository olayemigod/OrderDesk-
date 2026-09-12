# SellerTray WhatsApp PDF Receipts

## Contract

SellerTray generates order receipts deterministically from stored order data. PDF generation does not call the AI order parser or any LLM.

Customer WhatsApp self-service supports:

- `receipt` / `receipt for my last order`
- `I need receipt for my last order`
- `I have not gotten my receipt`
- `proof of purchase`
- `receipt NLM/000001`

When no customer reference is supplied, SellerTray resolves the latest order belonging to the WhatsApp customer. When an order ID is supplied, the lookup remains customer-scoped; another customer's order ID must not disclose data.

A PDF receipt is issued only for a completed order. If the resolved order is not completed, SellerTray returns its current status instead.

## Receipt identity and contents

The receipt uses the immutable SellerTray customer reference as its traceable reference. SellerTray does not introduce a second receipt number for MVP.

The generated PDF contains:

- merchant/business name;
- SellerTray customer reference;
- order date;
- customer WhatsApp identity;
- item description, quantity, unit price and line total;
- currency and total;
- final order status;
- fulfilment method/provider when available;
- customer WhatsApp receipt-confirmation provenance when available;
- SellerTray / ProcessEdge generation footer.

## Storage and privacy

- Bucket: `receipts`
- Bucket visibility: private
- MIME type: `application/pdf`
- Per-object size limit enforced by bucket: 2 MB
- Deterministic path: `<tenant>/<merchant-code>-<sequence>/receipt-v<version>.pdf`
- The first successful generation is cached on the order through `receipt_storage_path` and `receipt_generated_at`.
- Repeat receipt requests reuse the cached document instead of regenerating it.
- Merchant/customer clients do not receive a public Storage URL. The server-side WhatsApp worker downloads the private object with server credentials, uploads it to Meta as WhatsApp media, then sends it as a document message.

## WhatsApp delivery

For a completed order, SellerTray queues a short caption such as:

`Your PDF receipt for order NLM/000001 is attached. Total: NGN 55,000.00`

The governed outbound worker:

1. claims the notification;
2. downloads the PDF from private Supabase Storage;
3. uploads the PDF to the WhatsApp Cloud API media endpoint;
4. sends a WhatsApp `document` message referencing the returned media ID;
5. reconciles sent/failed state through the existing notification queue.

If PDF generation fails before queueing, SellerTray falls back to the deterministic text receipt rather than silently dropping the customer request.

## AI/token cost

PDF receipt handling is intentionally outside the AI billing path.

The following consume **zero LLM tokens**:

- receipt-intent detection for the governed phrases;
- merchant/reference extraction;
- latest-order resolution;
- order lookup;
- totals;
- PDF layout/rendering;
- private Storage upload/download;
- WhatsApp document delivery.

A receipt request does not create an `AI_ORDER_ACTIVITY` event.

Only a future explicit AI fallback for unsupported free-form customer requests could incur model tokens; that fallback is not part of this MVP receipt path.

## Production acceptance

Do not mark PDF receipt delivery production-accepted until Meta production credentials are active and a real WhatsApp E2E proves:

1. customer requests latest receipt;
2. customer requests a specific order by merchant/reference ID;
3. another customer's reference is rejected by customer scope;
4. incomplete order returns status rather than a receipt;
5. completed order produces a readable PDF;
6. repeated request reuses the cached PDF;
7. worker uploads and sends the document successfully;
8. notification delivery/failure reconciliation is correct.
