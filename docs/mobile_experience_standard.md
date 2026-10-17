# SellerTray Mobile Experience Standard

Status: MVP release acceptance contract

SellerTray is a merchant mobile application, not an ERP desk rendered on a phone. The MVP must meet the following product-experience rules before public release.

## 1. Primary information architecture

The merchant bottom navigation is:

1. **Home** — overview, setup progress and recent activity.
2. **Orders** — inbound/manual order creation, review and fulfilment workflow.
3. **Products** — catalogue and pricing management.
4. **More** — business profile, WhatsApp, notifications, team, plan/billing, account/privacy and permitted admin tools.

Products must never be buried inside Business settings.

## 2. Guided merchant journey

A new merchant should be able to understand the next action without documentation:

signup → email confirmation → sign in → create business → add products/prices → connect WhatsApp when available → create/receive test order → operate orders.

Home exposes a setup checklist until these core actions are complete.

## 3. Forms

- Every important field has a persistent visible label.
- Placeholder text is an example, never the only label.
- Optional and required intent is clear.
- Helper text explains non-obvious fields.
- Inputs use appropriate mobile keyboards.
- Passwords have an explicit show/hide control.
- Forms remain usable when the software keyboard is visible.
- Validation errors explain what the merchant can do next.

## 4. Navigation and gestures

- Primary tap targets are at least 44–48 device-independent pixels.
- Android system navigation must not overlap SellerTray controls.
- Android Back returns from a More subsection to the More menu before leaving the app.
- Pull-to-refresh remains available on the operational workspace.
- Destructive actions are never attached to casual swipe gestures.
- Loading, empty, error and disabled states must remain understandable.

## 5. Orders

- WhatsApp orders arrive automatically after a production WhatsApp connection.
- Merchants can create a manual order for phone, walk-in or other manually captured sales.
- Manual order creation selects products from the merchant catalogue and uses governed catalogue prices.
- Order lifecycle remains deterministic:
  needs review → accepted → processing → ready → completed.
- Reject/cancel require reasons according to the existing workflow contract.

## 6. WhatsApp

WhatsApp connection is a guided merchant setup experience, not an API-credential form.

Until Meta production approval is complete, SellerTray must show connection as pending/unavailable rather than implying a production connection exists.

When enabled, merchants should use the approved Meta onboarding flow from SellerTray. They should not configure webhook URLs, access tokens or API credentials manually.

## 7. Products

- Products have a first-class tab.
- Product creation exposes visible labels for name, selling price, category, SKU/code, customer words/aliases and image.
- Customer words explain how alternate WhatsApp wording improves order understanding.
- Active/inactive state and selling price are easy to scan.

## 8. Business, settings and account

Business profile is separate from operational settings.

More segments:
- Business profile
- WhatsApp connection
- Customer notifications
- Team & access
- Plan & billing
- Account & privacy
- ProcessEdge platform operations only for authorized platform administrators

Account deletion is located only in Account & privacy, behind an additional disclosure step. It must not be visually promoted alongside everyday settings.

Sign out remains easy to find and signs out only the current device.

## 9. Brand integrity

User-facing production identity is **SellerTray**.

No user-facing screen, message, error or merchant workflow may expose the previous **OrderDesk** product name. Historical lowercase internal identifiers may remain where required for backward compatibility, migrations, RPCs or legacy deep links.

## 10. Release acceptance

The mobile-experience gate closes only after physical Android QA confirms:

- guided authentication and onboarding;
- Home / Orders / Products / More navigation;
- Android-safe bottom navigation;
- native Android Back behavior inside More;
- labelled product creation;
- manual order creation;
- segmented settings;
- WhatsApp connection guidance;
- sign out;
- no visible OrderDesk branding;
- data export;
- successful disposable-account deletion and return to sign-in.
