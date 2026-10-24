# SellerTray Mobile Adaptive & Large-Screen Governance

Status: **Normative extension of `SKILL.md` for every SellerTray Mobile UI/UX task**

This extension defines how SellerTray Mobile must behave across phones, large phones, foldables, mini tablets, tablets and resizable application windows. It does not create a second commerce product, a second mobile codebase, or a second source of business truth.

## Governing rule

> One SellerTray Mobile operational product, adaptive to the available application window.

SellerTray Mobile must adapt presentation to the **current usable window size**, not to a guessed hardware category such as `phone` or `tablet`. The same installed application may move between compact and expanded layouts because of rotation, fold/unfold, split-screen, freeform windowing or future desktop-style Android environments.

Do not branch business behavior by device type. Branch, staff, permission, product, UOM, price, stock, customer, order, payment, shift, receipt, tax, reporting and offline authority remain shared and unchanged across layout modes.

## Relationship to SellerTray POS

Adaptive SellerTray Mobile and the planned **SellerTray POS** edition are related but not identical.

- SellerTray Mobile remains the general operational app and must work well from compact phones through large tablet windows.
- SellerTray POS may later provide a more purpose-built counter-screen experience, but it must reuse the same governed commerce and operational core.
- Do not create a separate tablet commerce engine merely because an expanded layout resembles a POS screen.
- Adaptive Mobile work may create reusable presentation primitives that SellerTray POS can later consume, but POS-specific entitlement or pricing remains governed by `COMMERCIAL.md` and later explicit product decisions.

## Window classes

Use these SellerTray width classes unless a later explicit decision changes them:

| Class | Available application width | Primary intent |
| --- | ---: | --- |
| **Compact** | `< 600dp` | Phones, narrow foldable panes, narrow split-screen windows |
| **Medium** | `600-839dp` | Mini tablets, portrait tablets, wide foldables |
| **Expanded** | `840-1199dp` | Standard tablets, landscape tablets, large foldables |
| **Large** | `>= 1200dp` | Large tablets and desktop-style application windows |

Implementation must derive the class from the live window dimensions and recompute it when the window changes. Do not cache a permanent `isTablet` decision at launch.

The thresholds are layout contracts, not business rules. A feature must keep the same authority, permissions and transaction outcome when moving between classes.

## Compact contract

Compact is the canonical phone experience.

1. Preserve the frozen primary navigation:
   - Home
   - Sell
   - Orders
   - Inventory
   - More
2. Preserve the phone Sell sequence:
   > Products -> Cart -> Payment
3. Do not place the full Cart or Payment form below a long product catalogue on compact screens.
4. Bottom navigation remains appropriate for the five primary destinations.
5. Forms are normally single-column unless a small inline row is clearly usable and accessible.
6. Drawers and detail surfaces may become full-screen sheets where space requires it.
7. Compact remains the reference layout for the smallest supported window; larger-layout work must not regress it.

## Medium contract

Medium should use additional space without turning the app into an unrelated tablet product.

1. Keep the same five primary destinations. Bottom navigation may remain where it stays ergonomic.
2. Home may show denser KPI/status grids instead of stretching two-column phone cards across the entire width.
3. Sell should increase catalogue density intelligently, normally to approximately 3-4 useful product columns depending on card minimum width, typography and accessibility settings.
4. Cart and Payment may remain staged if a persistent side pane would make the medium layout cramped.
5. Orders, Inventory and operational lists should expose more useful metadata per row/card where space allows.
6. Forms should use a readable maximum content width and may use two columns only for logically paired fields.
7. Modal, drawer and sheet widths must be bounded; do not stretch short forms edge-to-edge across a mini tablet.

## Expanded contract

Expanded is a true tablet layout, not a stretched phone layout.

### Sell

1. Product discovery and Cart may use a split workspace.
2. A typical arrangement is catalogue/search on the larger pane and current Cart on the secondary pane.
3. Payment remains a distinct governed stage even if it is presented by replacing the Cart pane, opening a dedicated pane/sheet, or otherwise avoiding a full-screen phone transition.
4. Search, barcode scan, customer context, Branch context and cart totals should remain visible or readily reachable without duplicating transaction state.
5. Product-card width must be based on a minimum usable card width / adaptive column count, not hard-coded phone percentages such as a permanent two-column `48%` layout.

### Orders and Inventory

1. Master-detail presentation is preferred where it reduces navigation churn:
   - order list -> order detail;
   - inventory list -> item/ledger detail;
   - transfer list -> transfer detail;
   - shift list -> shift detail where applicable.
2. Selecting detail must not create a second data cache or business truth; both panes consume the same governed record/read model.
3. Historical snapshots remain read-only regardless of presentation mode.

### Home and secondary workflows

1. Use bounded content regions and denser grids rather than merely enlarging whitespace.
2. Quick actions, attention items and operational summaries may sit side by side when the reading order remains clear.
3. Forms, reports and settings should use appropriate multi-column composition where fields are logically related, while preserving keyboard and accessibility usability.

## Large contract

Large windows may use a more persistent application shell and denser operational workspaces, but must remain SellerTray Mobile unless the user explicitly enters a later SellerTray POS edition/surface.

1. Avoid unbounded content stretching. Use sensible maximum content widths or pane constraints.
2. A navigation rail/sidebar may replace bottom navigation only when the resulting shell preserves the same five primary destinations and navigation semantics.
3. Sell may keep catalogue, Cart and relevant transaction context visible simultaneously where useful, but Payment authority and commit boundaries remain unchanged.
4. Do not expose Merchant Web administration merely because the screen is large. **Mobile performs; Web manages** still applies.

## Orientation, foldables and resizing

1. Do not rely on portrait orientation as the only valid geometry for Medium, Expanded or Large windows.
2. The UI must tolerate live width/height changes without losing the active Business, Branch, cart, draft, selected Customer, offline queue or other transaction state.
3. A layout transition must never submit, cancel, duplicate or recreate a transaction merely because the window class changed.
4. If camera/barcode scanning, Bluetooth printing or another device capability has orientation-specific behavior, handle that capability explicitly rather than locking the entire business workflow to a phone assumption.
5. Before changing the application orientation configuration, inspect Android/iOS behavior, camera/scanner flows, modal behavior and all relevant QA devices. Removing a portrait lock is an implementation decision governed by this contract, not an automatic documentation-only change.

## Typography and touch targets

Adaptive density must not be achieved by shrinking text or controls.

1. Preserve SellerTray typography minimums and the user-selected text-size behavior across window classes.
2. A wider screen should normally increase information density through layout, not smaller type.
3. Interactive controls must retain accessible touch targets and sufficient spacing.
4. Test long Business, Branch, Product, Customer and UOM labels; do not assume additional width removes truncation requirements everywhere.

## Performance and large catalogues

1. Additional screen area does not permit unbounded data loading.
2. Product catalogues, Orders, Inventory and reports must retain governed pagination/virtualisation/incremental-loading rules.
3. Expanded master-detail views must not fetch an entire merchant estate or catalogue just because more rows fit on screen.
4. Cache/offline behavior remains governed by the existing data and offline authorities.

## Offline and state continuity

1. Compact/Medium/Expanded/Large modes must use the same offline queue, idempotency keys and replay contracts.
2. Resizing or rotating must not duplicate an offline sale or discard queued payment evidence.
3. Cached products, stock, payment methods, tax context and policy data must not have separate tablet copies.
4. When an offline feature is unavailable in one mode, it must also be unavailable for authority reasons rather than a layout omission.

## iOS/iPad boundary

The same adaptive contract applies when SellerTray enables native iPad support.

- Do not create iPad-only business rules.
- Enabling tablet support in application configuration is a separate implementation/release action and must be accompanied by iPad/mini-tablet QA.
- iPhone behavior must remain Compact-compatible.

## Required adaptive QA matrix

Any Mobile UI change that can materially affect layout must verify the applicable subset of:

| Target | Minimum acceptance |
| --- | --- |
| Narrow phone / Compact | No clipping; primary flows usable; five-tab navigation intact |
| Large phone / Compact | No excessive stretching or broken wrapping |
| Mini tablet / Medium | Useful density; bounded forms; no giant phone cards |
| Tablet portrait / Medium or Expanded | Adaptive columns/panes; readable content widths |
| Tablet landscape / Expanded | Split layouts where applicable; no stale phone-only geometry |
| Large window / Large | Bounded panes/content; efficient navigation |
| Resize/fold transition | State preserved; no duplicate/replayed action caused by layout change |
| Large text | No critical clipping; controls remain usable |
| Dark/light mode | Both adaptive layouts preserve semantic colors and contrast |

For Sell specifically, test at minimum:

- product catalogue density;
- search and barcode access;
- UOM selection;
- zero/insufficient stock behavior;
- Cart editing;
- customer selection;
- tax/total display;
- split/partial/pay-later policy where enabled;
- online and offline completion/replay;
- Branch change invalidation;
- successful transition from Products/Cart to Payment in every layout class.

## Implementation sequence

Use this sequence unless the user explicitly reprioritises it:

### M-AD0 — Adaptive foundation

- add one shared window-class hook/utility;
- add shared bounded-content and responsive-grid/pane primitives;
- add automated source/contracts for breakpoints and forbidden permanent phone-only assumptions;
- do not change transaction authority.

### M-AD1 — Shell + Home

- adapt header/context/nav placement;
- make Home KPI/status/attention layouts responsive;
- preserve primary navigation semantics.

### M-AD2 — Sell

- replace fixed two-column phone product sizing with adaptive column sizing;
- retain Compact staged Products -> Cart -> Payment;
- add Expanded catalogue + Cart split workspace;
- keep one cart/payment state and one governed checkout authority.

### M-AD3 — Orders + Inventory

- introduce master-detail layouts where useful;
- preserve immutable history and governed inventory operations.

### M-AD4 — Secondary workspaces

- shifts, expenses, purchasing/receiving, transfers, counts, printers, WhatsApp, notifications, feedback and other operational surfaces.

### M-AD5 — Device acceptance

- Android phone, mini tablet and tablet acceptance;
- fold/resize where available;
- iPad acceptance when native tablet support is enabled;
- orientation/configuration decision based on verified behavior rather than assumption.

## Anti-patterns

Do not:

- create a separate tablet database/API/commerce flow;
- add permanent `isTablet` business branching based only on hardware identity;
- keep a hard-coded two-column phone grid on all large screens;
- simply stretch phone forms/cards across tablet width;
- duplicate cart/order/payment state between panes;
- move Merchant Web administration into Mobile because a tablet has more space;
- remove the Compact phone sequence in order to optimise tablets;
- declare tablet compatibility complete merely because the APK installs and opens on a tablet;
- treat portrait lock as proof that large-screen support is complete.

## Completion reporting

When adaptive work is implemented, report:

- window classes changed;
- screens changed;
- actual devices/emulators/window sizes verified;
- portrait/landscape/resize behavior verified;
- Compact regressions checked;
- offline and transaction-state continuity checked;
- any iPad configuration/build change;
- whether the change belongs to SellerTray Mobile or the later SellerTray POS track.
