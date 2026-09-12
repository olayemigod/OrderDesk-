# SellerTray Commercial Pricing Proposal

**Status:** PROPOSED — NOT APPROVED / NOT ACTIVE  
**Prepared:** 2026-09-10  
**Commercial owner approval required before any database or Paystack activation.**

## Recommended founding launch price

- Monthly base subscription: **₦2,000**
- Successful AI-assisted order activity: **₦5 per AI_ORDER_ACTIVITY**
- Trial: **14 days free**
- Trial AI activity is measured for product analytics but remains non-billable.
- No percentage-of-sales or GMV fee.
- WhatsApp-first MVP only; future sales channels are separate paid add-ons rather than bundled into the base plan.
- SellerTray SaaS payment-processing cost should be absorbed by ProcessEdge during the founding launch rather than added as a confusing surcharge. Customer-payment processing, if introduced later, must remain transparent and separate from SellerTray SaaS pricing.
- Meta WhatsApp Business Platform charges are **not included** in SellerTray subscription or AI-activity pricing. Connecting a WABA/phone number to SellerTray is not itself a SellerTray usage charge.
- Each merchant remains responsible for its own Meta WhatsApp Business Account payment method and any billable Meta messaging under Meta's then-current pricing, unless ProcessEdge later adopts a separately approved Solution Partner/credit-line billing model.
- SellerTray must not apply a percentage markup to Meta messaging charges in the MVP.

## WhatsApp provider billing boundary

SellerTray and Meta billing are separate commercial relationships for the MVP:

1. **SellerTray bill** — monthly base subscription plus the approved flat AI-assisted activity charge.
2. **Meta bill** — any WhatsApp Business Platform messaging charges assessed by Meta to the merchant's WABA under Meta's current rate card.
3. **Connection itself** — connecting a WhatsApp Business number to SellerTray does not create a SellerTray usage charge and should not be represented as a paid SellerTray feature transaction.
4. **Merchant payment method** — Meta may require the merchant to maintain a payment method on its WABA for Meta messaging. SellerTray must disclose this before Embedded Signup completion.
5. **No hidden pass-through markup** — SellerTray MVP does not add a percentage-of-message-cost or percentage-of-sales fee to Meta charges.
6. **Pricing changes** — SellerTray UI/Terms must avoid promising that WhatsApp messaging is permanently free because Meta pricing can change independently of SellerTray.

This boundary should remain in force until ProcessEdge explicitly approves a different Meta commercial model.

## Founding-price guardrail

Recommended offer structure:

- Available to the first **100 paying businesses** or for the first **90 days after public launch**, whichever occurs first.
- Founding merchants keep the ₦2,000 + ₦5/activity rate for **12 months from first paid activation**.
- Do not promise a permanent lifetime price.
- Do not publish a successor standard price until pilot economics and retention are measured.

These cohort limits are recommendations, not active commercial terms until Product Owner approval.

## Merchant bill examples

| Successful AI-assisted orders in billing period | Base | Usage | SellerTray total |
| ---: | ---: | ---: | ---: |
| 0 | ₦2,000 | ₦0 | ₦2,000 |
| 25 | ₦2,000 | ₦125 | ₦2,125 |
| 50 | ₦2,000 | ₦250 | ₦2,250 |
| 100 | ₦2,000 | ₦500 | ₦2,500 |
| 200 | ₦2,000 | ₦1,000 | ₦3,000 |
| 500 | ₦2,000 | ₦2,500 | ₦4,500 |
| 1,000 | ₦2,000 | ₦5,000 | ₦7,000 |

Only a successful external-AI-assisted order that creates a SellerTray order is a billable activity. Fallback parsing, manual entry, duplicate webhook retries, failed/invalid AI parsing, trial usage and usage recorded before a paid rate is active are not charged.

## Competitive position checked 2026-09-10

Current public reference points:

- OrderBridge: ₦3,000/month after 14-day trial.
- Oga Stock Lite: ₦2,500/month; Standard ₦6,500/month.
- Speedfi Starter: ₦5,850/month with WhatsApp AI ordering.
- QShop Pro: ₦6,250/month; public site currently advertises 50 WhatsApp orders/month.
- Mesa Starter: ₦12,000/month for up to 100 orders, then ₦150 per extra order.

Primary source pages:
- https://getorderbridge.com/
- https://ogastock.ng/pricing
- https://speedfi.ng/
- https://qshop.tech/
- https://getmesa.co/

At the proposed founding rate:

- SellerTray equals OrderBridge at 200 successful AI-assisted orders/month.
- SellerTray remains below Speedfi Starter until about 770 AI-assisted orders/month.
- SellerTray remains below QShop Pro until about 850 AI-assisted orders/month.
- SellerTray costs ₦2,500 at 100 AI-assisted orders versus Mesa Starter at ₦12,000.

The objective is not to remain the cheapest product at every possible volume. The objective is to make initial adoption economically trivial for the broad SME target while allowing SellerTray revenue to grow with actual AI-assisted order value.

## AI unit-economics control

The production parser uses `gpt-5.6-luna`, `store: false`, strict structured output and `reasoning.effort = none`.

The ₦5 activity rate must not be treated as permanently validated until pilot telemetry establishes the real cost of:
- OpenAI input/output tokens across merchant catalogue sizes;
- AI attempts that safely fall back and therefore generate no billable event;
- WhatsApp/provider costs attributable to the workflow;
- support load and infrastructure overhead.

Recommended pricing review triggers after launch:
- review after the first 30 paid merchants;
- review after the first 10,000 AI-assisted order attempts;
- review if variable cost per successful billable AI activity approaches the ₦5 charge closely enough to remove a safe contribution margin;
- review conversion, churn and order-volume distribution before setting the post-founding public price.

## Billing activation boundary

Do not write these proposed prices to `subscription_plans` or Paystack until Product Owner approval.

After approval, activation must still follow the governed billing checklist:
1. Set approved base price and AI activity price.
2. Create/confirm the matching Paystack base subscription plan.
3. Configure server-only provider/encryption/settlement credentials.
4. Keep both usage charging gates disabled.
5. Run Paystack test-mode base subscription and reusable-authorization acceptance.
6. Run one closed-period variable-usage settlement and exact amount/currency reconciliation.
7. Confirm duplicate-debit controls and Verify Transaction recovery.
8. Only then enable both production usage-charging gates.


## Telemetry implementation status

The unit-economics measurement infrastructure is now deployed:
- `order-parser` uses `reasoning.effort = none`;
- parser responses expose internal token-count metadata only;
- `whatsapp-webhook` persists one non-content `ai_parser_attempts` row per external attempt;
- ProcessEdge Admin aggregates attempts, successes/fallback-errors and token totals by current period, including cached input separately;
- Owner export includes the non-content telemetry;
- merchant clients cannot access the telemetry table directly.

**Current live sample remains zero** because production external-AI acceptance has not yet been completed. Therefore the proposed ₦2,000 + ₦5 founding price remains a commercial proposal, not validated production pricing.

Before numeric pricing activation, ProcessEdge should record a representative live/test sample and review:
1. average uncached input, cached input and output tokens per successful order;
2. attempts per successful billable order;
3. fallback/error rate;
4. variable AI cost per successful billable activity;
5. contribution margin at the proposed ₦5 activity charge.


## AI catalogue context budget

To keep the founding usage price viable as merchants grow, SellerTray does not send an unbounded merchant catalogue to the AI parser.

Current production contract:
- the full active catalogue remains server-side for deterministic post-parse item/price matching;
- AI receives at most **160** lexically ranked catalogue items per order;
- AI receives at most **6 aliases per selected item**;
- merchants with small catalogues continue to send the complete active catalogue;
- context telemetry records total catalogue size, items sent and aliases sent without storing catalogue content in the telemetry row.

The 160/6 limits are release-gated. Pricing review must compare fallback/error rate and successful-order token cost against catalogue size before changing them.
