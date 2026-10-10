# SellerTray MVP Acceptance QA

This checklist is the release acceptance boundary for the current SellerTray MVP. It separates automated evidence from manual device and merchant-persona validation so a green build is never mistaken for complete operational acceptance.

## Release candidate

- Branch: `feat/sellertray-merchant-web-v1`
- Mobile/shared base: `feat/sellertray-mobile-shell-v2`
- Merchant Web stacked PR: #10
- Validated Android QA build commit: `b2b37bd9842458dc37efe9346ef00031821fa23c`
- QA artifact: `sellertray-qa-b2b37bd9842458dc37efe9346ef00031821fa23c`
- Artifact SHA-256: `5776c7b6dc1f92b7b10aa267ab0a2009f97a8fe18f8e073ba799fa1f92dfd774`
- Android package: `com.orderdesk.app`
- Android versionCode: `18`

A later Merchant Web-only CI commit does not change the validated mobile APK bytes.

## Automated acceptance already required

The following must be green for the candidate under review unless explicitly marked as a documented upstream blocker.

| Area | Automated evidence | Required result |
| --- | --- | --- |
| Database | Full migration replay | Pass |
| Database | Complete SellerTray pgTAP suite | Pass |
| Mobile | TypeScript | Pass |
| Mobile | Production Android bundle smoke | Pass |
| Mobile | SellerTray release preflight | Pass |
| Android native | Expo prebuild + Kotlin compile | Pass |
| QA APK | Release APK assembly | Pass |
| QA APK | ZIP/archive integrity | Pass |
| QA APK | APK signature verification | Pass |
| QA APK | Package + versionCode match `app.json` | Pass |
| QA APK | `BLUETOOTH_CONNECT` present | Pass |
| QA APK | `BLUETOOTH_SCAN` absent | Pass |
| QA APK | Coarse/fine/background location permissions absent | Pass |
| Merchant Web | TypeScript | Pass |
| Merchant Web | Security/AI preflight | Pass |
| Merchant Web | Production build | Pass |
| Merchant Web | Production dependency audit | Pass |
| Merchant Web | Headless Chrome login-surface smoke | Pass |

### Documented mobile dependency-audit blocker

The mobile dependency audit remains intentionally red while high-severity advisories remain in the supported Expo/Metro toolchain without a non-breaking upstream resolution. Do not:

- run a forced audit fix that downgrades Expo;
- suppress the advisory;
- add an unverified override;
- weaken the audit threshold merely to make CI green.

Treat this as an explicit release-risk decision until a compatible upstream fix exists.

## Test data setup

Use one merchant business with at least:

- two active Branches;
- one Owner;
- one Manager;
- one Staff member assigned to the default Branch only;
- one Staff member assigned to both Branches;
- one product sold in Stock UOM;
- one product with an alternate selling UOM and a different Purchase UOM;
- independent UOM prices;
- at least one barcode mapped to a Product + UOM;
- stock in both Branches;
- one configured register in each Branch;
- one paired ESC/POS Bluetooth printer where hardware QA is performed;
- one connected WhatsApp number routed to a known receiving Branch;
- cash and bank-transfer payment methods enabled.

Do not use production customer data for QA.

## Merchant Web persona acceptance

### Owner

- Sign in using the normal SellerTray account.
- Confirm the management shell opens and all management navigation is visible.
- Switch business where more than one manageable business exists.
- Switch between active Branches and confirm Dashboard, Orders, Inventory and Cash data follow the selected Branch.
- Confirm inactive Branch history remains readable where historical views apply but the inactive Branch cannot be used for new operations.
- Create/edit a Product without bypassing Stock UOM rules.
- Add an alternate UOM and verify conversion, barcode, fractional policy and independent selling price.
- Change default Selling/Purchase UOM and confirm Stock UOM remains unchanged.
- Create/edit a Branch; confirm the default Branch cannot be disabled without first choosing another default.
- Invite a Manager and Staff member.
- Change a Staff member's Branch access and capabilities.
- Confirm the first custom Staff Branch grant preserves inherited default-Branch access.
- Reset Staff Branch access and confirm default-only fallback is restored.
- Configure the WhatsApp receiving Branch and confirm only future inbound work follows the new route.
- Review Devices & Printers without browser Bluetooth execution controls.
- Review Purchasing, Purchase Receipts and Report Center.
- Confirm the AI Brief is read-only/assistive and cannot perform commercial mutations.

### Manager

- Sign in and confirm Merchant Web access is allowed.
- Confirm normal management/reporting surfaces are available.
- Confirm Manager can manage Staff but cannot promote another user to Manager where Owner authority is required.
- Confirm Manager cannot perform Owner-only WhatsApp credential connection/disconnection.
- Confirm Manager can change the governed WhatsApp receiving Branch where allowed.
- Confirm Branch/capability changes are limited by server authority, not only hidden UI.

### Staff

- Attempt Merchant Web sign-in with a valid Staff account.
- Confirm Staff is not granted the Owner/Manager web workspace and is directed to mobile operations.
- Confirm direct URL/navigation attempts do not expose management data.

## Mobile operational acceptance

### Branch and session context

- Sign in as Owner/Manager and confirm active Branch switching works.
- Sign in as default-only Staff and confirm only the allowed Branch is operationally available.
- Sign in as multi-Branch Staff and confirm only explicitly allowed Branches plus preserved default access are available.
- Open a cashier shift and confirm the active shift pins cashier operations to its Branch until close.

### Sell / POS

- Open a shift with opening cash.
- Add a Stock-UOM product to cart.
- Add an alternate-UOM product and verify displayed conversion to Stock UOM.
- Use barcode resolution where configured and confirm Product + UOM are correct.
- Attempt to sell above available Branch stock and confirm the UI/server blocks completion.
- Complete a cash sale and confirm:
  - one completed order;
  - one confirmed cash payment;
  - one issued financial receipt;
  - correct immutable Stock-UOM deduction;
  - correct Branch/register/shift attribution;
  - expected cash increases exactly once.
- Retry a completed-sale request using the same idempotency boundary and confirm no duplicate order/payment/stock movement.
- Create an unpaid POS draft and void it; confirm zero payment and zero stock effect.
- Return an eligible completed cash sale as Owner/Manager; confirm the original sale/payment/receipt remain historical truth and compensating refund/stock records are created.

### Inventory

- Receive stock using Purchase UOM and verify normalization to Stock UOM.
- Adjust stock with a mandatory reason/reference.
- Attempt an adjustment below zero and confirm rejection.
- Start a Stock Count; capture zero and non-zero quantities; review variance; apply with authorized capability.
- Confirm count apply posts ledger variance rather than overwriting on-hand quantity.
- Create a Branch transfer; dispatch and receive it; confirm source/destination ledger effects and immutable history.
- Deactivate a Branch after historical stock activity and confirm history remains readable while new operations are blocked.

### Cash & Shift

- Record cash in, cash out and expense movements with references/reasons.
- Attempt cash out/expense above expected drawer cash and confirm rejection.
- Close a shift with exact cash and confirm zero variance.
- Close another shift with a variance and required explanation.
- Review the closed shift as Owner/Manager.
- Confirm concurrent sale/refund activity cannot race a closing shift into an inconsistent drawer balance.

### WhatsApp

- Confirm the connected number's receiving Branch is visible.
- Send an inbound customer message and confirm the message/order lands in the configured receiving Branch.
- Change the receiving Branch, then send a new inbound message and confirm only the new message follows the new route.
- Confirm historical messages/orders retain their original Branch.
- Confirm the same customer can have independent unread state by Branch.
- As Staff, confirm another Branch's orders/messages/notifications are not visible.
- Send payment options from an eligible WhatsApp conversation and confirm the existing shared payment flow is used.

### Offline / retry

- With network available, prepare a safe draft/retry-capable operation.
- Interrupt connectivity at the supported offline boundary.
- Confirm the app presents explicit offline/retry state rather than reporting a transaction as completed.
- Restore connectivity and retry.
- Confirm idempotency prevents duplicate orders, payments, stock movements, counts, transfers or print jobs as applicable.
- Confirm unsupported offline commercial completion remains blocked rather than creating a second local commerce model.

## Bluetooth printer physical acceptance

This section is manual and cannot be accepted from CI alone.

### Setup

- Install the validated QA APK on an Android device.
- Pair the thermal printer in Android Bluetooth settings before opening SellerTray.
- Confirm SellerTray requests/uses Bluetooth connection permission without scan/location permission.
- Open Devices & Printers and select the already-paired device.
- Configure 58 mm or 80 mm paper width correctly.

### Test print

- Run a test print.
- Confirm one physical print is produced.
- Confirm a failed printer connection marks only the print attempt failed and does not create an order/payment/stock change.

### Sale receipt

- Complete a real QA cash sale.
- Print the issued receipt.
- Confirm merchant identity, receipt/order reference, items, selected UOM quantities, totals and payment evidence are legible.
- On 58 mm paper, confirm wrapping/alignment is usable.
- On 80 mm paper, confirm wider layout is usable.
- Confirm `NGN` text renders consistently on low-cost ESC/POS hardware.

### Reprint

- Reprint the same receipt.
- Confirm a new print attempt is recorded but no duplicate sale/payment/stock movement/financial document is created.
- Simulate a printer disconnect after sale completion and confirm the sale remains completed and can be reprinted after reconnect.

## Final acceptance record

For every manual run, record:

- date/time;
- tester;
- app commit and APK artifact name;
- Android device/model and OS version;
- printer make/model and paper width;
- merchant/business used;
- Branch and persona;
- scenario IDs tested;
- pass/fail;
- screenshots or photos for visual/hardware defects;
- linked GitHub issue/PR for every failure;
- retest result after correction.

Do not mark the MVP release checkpoint accepted until all mandatory automated gates are green except an explicitly accepted upstream blocker, and the required physical Android/printer/persona scenarios above have been completed.