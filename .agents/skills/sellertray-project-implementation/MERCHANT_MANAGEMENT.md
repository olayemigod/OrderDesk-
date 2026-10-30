---
name: sellertray-merchant-management
description: "Normative SellerTray Admin merchant-management extension governing Merchant 360, merchant account lifecycle, ProcessEdge support/intervention authority, legacy Admin mutation retirement and cross-surface account-state enforcement."
metadata:
  author: ProcessEdge Solutions Limited
  product: SellerTray
  version: "0.1.0"
  status: governing-extension
---

# SellerTray Merchant Management Governance

## Status and precedence

This file is a normative extension of `SKILL.md`, `CROSS_SURFACE.md`, `INTELLIGENT_IMPLEMENTATION.md`, `ADMIN_CAPABILITIES.md`, `ADMIN_NAVIGATION.md`, `COMMERCIAL.md`, `COMMERCIAL_V2.md` and `OA5_C2_SEQUENCE.md`.

It records the later explicit product decision approved on 2026-10-30 that ProcessEdge must have a governed avenue to manage and support merchants in addition to SellerTray's automated subscription lifecycle.

This extension does **not** create a second merchant, subscription, payment, entitlement, agreement, setup, Branch, WhatsApp or operational truth engine.

The governing architecture remains:

> Mobile performs. Web manages. WhatsApp sells. AI assists. Admin operates the platform. Shared core governs business truth.

# 1. Operating model

SellerTray uses three complementary responsibility paths:

1. **Automation handles the normal lifecycle** — commercial orders, settlement, setup/readiness, activation, entitlement, renewal attention and other governed lifecycle transitions remain derived or command-driven from shared authority.
2. **Merchant Web handles merchant self-service** — authorised merchant users manage normal subscription, Branch, billing and business administration through governed commands.
3. **SellerTray Admin handles ProcessEdge supervision, support and exceptional governed intervention** — ProcessEdge may inspect, support, correct and recover merchant state only through explicit server-governed capabilities and commands.

Admin intervention must never mean direct table editing or fabricating a lifecycle prerequisite.

# 2. Merchant 360 is the central merchant record and launch point

SellerTray Admin must provide one governed Merchant 360 experience for understanding a Business across its platform relationship.

Merchant 360 should expose, as governed facts/read models become available:

- **Overview** — Business identity, account age, account state, recent activity and attention indicators;
- **Business Profile** — governed merchant identity/contact/business details and authorised correction history;
- **Ownership & Team** — Owner, Managers, Cashiers, membership health and governed ownership-transfer entry point;
- **Branches** — every Branch, operational status, setup/activation state and Branch subscription summary;
- **Commercial** — Branch subscriptions, Plan Profile/version, renewal/expiry, commercial orders, installment state, balances, payments and exceptional extension history;
- **Onboarding & Activation** — onboarding progression, setup appointments, completion evidence, readiness and named blockers;
- **Channels & Devices** — WhatsApp connection/health, registered devices/printers and applicable integration status;
- **Support & Security** — internal support context, account restrictions/suspensions, security interventions and recovery status;
- **Activity & Audit** — immutable ProcessEdge privileged-action history plus relevant merchant lifecycle history.

Merchant 360 is a contextual summary and launch point, not a catch-all mutation page. Where another first-class Admin workspace owns the action, Merchant 360 must deep-link with the merchant/Business context preserved.

Examples:

- outstanding commercial balance -> **Payments & Settlement**;
- setup blocker -> **Branch Readiness** / **Activation Queue**;
- plan/price concern -> **Plans & Pricing** or the exact Branch subscription work object;
- agreement status -> **Agreements** review;
- WhatsApp incident -> **WhatsApp Operations**;
- ownership correction -> the dedicated governed ownership-transfer action.

# 3. Merchant Account Lifecycle is independent of subscription state

SellerTray must introduce a governed **Merchant Account Lifecycle** authority distinct from Branch subscription/entitlement state.

The target lifecycle must be capable of representing at least:

- **Normal** — no ProcessEdge account-level restriction;
- **Restricted** — bounded platform restriction exists, with the exact affected capabilities/surfaces determined by governed policy;
- **Suspended** — stronger ProcessEdge account-level suspension blocks affected operational access according to governed policy while preserving data, billing/recovery and audit access as required;
- **Closed** — the merchant account is administratively closed and normal operations are unavailable; any restoration/reopening, if policy permits, is a separate governed action.

Exact database identifiers may differ after schema inspection. Do not implement these states as browser-only labels.

Account lifecycle and commercial lifecycle are separate dimensions. A merchant can have a financially current Branch subscription while the Business is restricted for a security/legal reason, or can have a normal account while one Branch is commercially past due.

Conceptually, effective operational authority becomes:

> Merchant Account Lifecycle × Branch Subscription Entitlement × User Role/Capability × Branch/Scope Authority × Business-State Rule × Available Limit/Quota

No one dimension may silently overwrite the history or meaning of another.

# 4. Account-lifecycle transition rules

Every merchant account-state mutation must use an explicit governed command/event and preserve:

- Business/tenant subject;
- prior state;
- new state;
- reason category and human-readable reason;
- authorised ProcessEdge actor derived from verified identity;
- applicable ProcessEdge capability;
- effective timestamp;
- optional effective-until/expiry where a temporary restriction is supported;
- supporting evidence/reference where required;
- idempotency command identifier for retryable mutations;
- immutable audit event;
- restoration/reversal linkage when the restriction is lifted.

A reason is evidence/context, not authorization. Capability, scope, AAL2 and command invariants remain mandatory.

Do not silently delete merchant data, commercial history, staff history, Branch history, stock history, payments, agreements or audit history when an account is restricted, suspended or closed.

# 5. ProcessEdge merchant-management capability boundary

`ADMIN_CAPABILITIES.md` remains the base authority model. Merchant-management implementation must map narrowly scoped server capabilities rather than rely on a coarse `admin` browser flag.

The target capability families should support the following semantic boundaries, subject to reconciliation with the existing capability schema:

- `admin.merchants.read` — paginated merchant estate discovery;
- `admin.merchant_detail.read` — Merchant 360 detail;
- `admin.merchant_support.manage` — bounded support notes/context and non-commercial support metadata;
- `admin.merchant_profile.correct` — governed correction of eligible merchant profile facts;
- `admin.merchant_account_state.manage` — restrict, suspend, restore or close merchant account state;
- `admin.merchant_ownership.transfer` — governed ownership transfer/correction;
- existing narrow commercial/setup/payment/entitlement/operations capabilities for actions owned by those domains.

Exact identifiers may be adapted during implementation, but the boundaries must remain distinct. Ordinary support access must not imply account suspension, ownership transfer, payment reconciliation or entitlement authority.

Platform Support is read/review first. Sensitive merchant-account or commercial mutations are not granted by default merely because a user has the Support persona.

# 6. Approved Admin intervention classes

ProcessEdge Admin may provide governed intervention paths for the following classes where the underlying business authority exists:

## Merchant/account administration

- review and correct eligible Business profile details;
- maintain internal support context;
- govern account restriction/suspension/restoration/closure;
- transfer/correct Business ownership through the dedicated membership authority;
- review Branch/team/device/channel state;
- recover access where a dedicated secure recovery authority exists.

## Commercial intervention

Admin may initiate or approve only through the owning commercial authority, for example:

- exceptional subscription extension as an immutable entitlement/commercial event;
- merchant/order discount or adjustment;
- off-gateway/direct payment confirmation with required evidence;
- payment/settlement reconciliation;
- installment-policy override;
- entitlement reconciliation/recovery;
- Branch setup/readiness recovery;
- plan/price/entitlement override where Commercial V2 explicitly permits it.

These actions remain commercial events. Merchant Management provides context and navigation; it does not replace their domain commands.

## Platform/channel intervention

Where approved and governed, Admin may perform platform-level WhatsApp/device/integration recovery through the owning operations authority. It must not manually set a connection status merely to make the UI appear healthy.

# 7. Explicitly prohibited shortcuts

Merchant Management must not provide a generic mechanism to:

- directly set a Branch subscription to `active`, `past_due`, `suspended`, `cancelled` or another commercial state outside the commercial lifecycle command;
- directly edit `active_until`, `current_period_end`, entitlement months or renewal dates;
- fabricate a payment/provider confirmation;
- fabricate Master Agreement acceptance, Order Form confirmation or Agreement Package evidence;
- mark Branch setup/readiness complete without the governed completion evidence;
- manufacture activation/entitlement state;
- write protected merchant/commercial tables directly from Admin Web;
- use a generic "force state" control as the normal support tool;
- let Merchant 360 become a second implementation of commercial, setup, WhatsApp or entitlement logic.

When ProcessEdge must override a normal lifecycle outcome, the override itself must be a named governed event with explicit semantics, scope, reason and audit.

# 8. Legacy Admin mutation retirement

The current compatibility implementation includes coarse tenant-admin actions such as:

- `set_subscription_status`;
- `extend_trial_days`;
- `set_whatsapp_status`;
- generic `platform_admin_mutate_tenant` behavior used to apply those legacy state changes.

These controls are **legacy compatibility only**. They must not be expanded as the target Merchant Management implementation.

C2 must inventory every caller and replace/retire them as follows:

1. subscription status -> governed Branch subscription/commercial lifecycle command or resolver-derived state;
2. trial extension -> retire with no-trial compatibility; exceptional extension uses an immutable entitlement/commercial extension event;
3. WhatsApp status -> derive connection/health from the governed WhatsApp authority; any ProcessEdge intervention uses an explicit operations command rather than writing a healthy/error label;
4. support note -> may remain as bounded support metadata only after explicit `admin.merchant_support.manage` enforcement and immutable audit are verified;
5. generic tenant mutation -> may remain only for narrowly named actions whose semantics, capability, validation and audit are explicit; it must not be an unrestricted state-write escape hatch.

Legacy actions may remain temporarily during migration where existing supported flows require them, but they must be removed only after replacement parity is proven. Do not break a current legitimate support path merely to delete a legacy function early.

# 9. Merchant Attention and work queues

Admin should support a governed **Merchant Attention** portfolio/read model when sufficient facts exist.

Attention signals may include, where authoritative:

- onboarding/setup blockers;
- activation/reconciliation failure;
- payment/settlement exceptions;
- upcoming/expired subscription attention;
- current account restriction/suspension;
- WhatsApp/service incident;
- unresolved support issue;
- ownership/access anomaly;
- guarantee/refund attention;
- repeated notification/delivery exception.

Attention is a projection of owning domain facts. It must not create another status engine.

Each attention item should identify:

- merchant/Business;
- Branch where applicable;
- owning domain;
- severity/priority where governed;
- reason/blocker;
- age/time-in-state where safely server-derived;
- next valid ProcessEdge action or owning workspace;
- resolved/dismissed semantics only where an explicit workflow exists.

# 10. Cross-surface account-state contract

Merchant account lifecycle affects shared runtime authority and therefore must be assessed across all SellerTray surfaces.

## Shared Core

Owns account lifecycle state/events, transition commands, audit, effective-state resolver and intersection with Branch entitlement/runtime access.

## Admin Web

Owns merchant estate, Merchant 360, Merchant Attention and authorised ProcessEdge interventions.

## Merchant Web

Reads the same effective account state and presents an appropriate explanation/recovery path. It must not recreate account-state rules locally.

## Mobile

Reads the same effective account state. Restricted/suspended/closed behavior must fail consistently with Merchant Web while preserving permitted recovery/billing/support actions according to governed policy.

## WhatsApp

Must not continue automated selling when the effective account/Branch entitlement authority says selling is unavailable. It consumes the same resolver rather than maintaining a channel-specific suspension flag.

## AI

May explain current merchant/Branch availability and next action from governed state. It must not override account restrictions or entitlements.

## Reporting/Audit

Must preserve account-state history, reasons, actors, effective dates, restoration events and operational/commercial impact without rewriting historical transaction facts.

## Offline/Sync

Offline access must use bounded/versioned runtime authority and revalidate on reconnect/replay. Implementation must explicitly define stale-cache treatment for new restrictions/suspensions; offline must not become a permanent bypass of a server-enforced merchant account state.

# 11. Merchant 360 information architecture contract

Merchant 360 may use tabs/sections because all views describe the same merchant record/context. Recommended views are:

1. Summary;
2. Business Profile;
3. Ownership & Team;
4. Branches;
5. Commercial;
6. Onboarding & Activation;
7. Channels & Devices;
8. Support & Security;
9. Activity & Audit.

Do not render every ProcessEdge action inline merely because the merchant is selected.

Primary Merchant 360 actions should be bounded to merchant-record responsibilities such as support context, eligible profile correction, account-state intervention and ownership transfer. Commercial/setup/channel actions should open the dedicated owning workspace with merchant/Branch context already selected.

# 12. Merchant-profile correction policy

Not every merchant fact is safely editable after creation.

Before exposing a profile correction, classify the field as one of:

- mutable contact/display metadata;
- identity/legal fact requiring stronger evidence;
- immutable historical identifier;
- derived field owned by another domain.

Corrections must preserve previous value, new value, actor, reason, timestamp and evidence where appropriate.

Do not use profile correction to rewrite transaction snapshots, accepted legal evidence, payment identities, Branch historical attribution or other immutable facts.

# 13. Ownership transfer policy

Business ownership transfer is a sensitive membership operation, not a profile edit.

It must preserve the `ADMIN_CAPABILITIES.md` requirements including:

- explicit ownership-transfer capability;
- AAL2/MFA;
- exact Business scope;
- source and destination identities;
- reason;
- idempotency command identifier;
- membership invariants;
- immutable audit;
- safe handling of the previous Owner's continuing/removal role according to the approved transfer command;
- no impersonation of the new Owner by ProcessEdge.

Merchant agreement acceptance remains merchant authority. Ownership transfer must not fabricate legal acceptance for the incoming Owner.

# 14. Security, audit and privacy

Merchant Management is cross-tenant ProcessEdge tooling and is therefore high privilege.

Requirements:

1. SellerTray Admin access remains AAL2/MFA protected.
2. Browser visibility is not authorization; server capability/scope checks are final.
3. Service-role credentials remain server-side only.
4. Every sensitive merchant mutation writes an immutable privileged-action audit event.
5. Audit records preserve actor, Business/Branch scope, action, before/after state where applicable, reason/evidence and timestamp.
6. Read/export of merchant estate data must be capability-controlled and bounded; do not load the full estate into browser memory.
7. Merchant secrets/tokens/provider credentials must not be exposed merely because an Admin can review Merchant 360.
8. Support notes must not become an uncontrolled store for secrets or unnecessary sensitive personal data.

# 15. C2 integration and sequencing

This decision is part of the **Commercial V2/C2 target design**, but recording it does not start C2 before OA5C acceptance.

C2 must incorporate Merchant Management as follows:

## C2-0 — Governance reset

Freeze merchant account lifecycle as independent from Branch subscription state and prohibit generic direct-state Admin shortcuts as target architecture.

## C2-1 — Current authority inventory

Inventory:

- Merchant Portfolio/Merchant 360 reads;
- `platform-admin` actions;
- `platform_admin_mutate_tenant` callers;
- subscription/trial/WhatsApp direct mutations;
- ownership-transfer authority;
- support notes;
- merchant/account restriction fields or policies already present;
- all Mobile/Merchant Web/WhatsApp/AI runtime gates that would need account-state enforcement.

## C2-4 / C2-5 — Branch subscription + resolver

Keep merchant account state separate from Branch subscription rows, but make the shared runtime/effective-access resolver intersect both dimensions.

## C2-9 — Cross-surface convergence

Implement the Admin Merchant Management experience, Merchant 360 expansion, Merchant Attention, account-state commands and dependent Merchant Web/Mobile/WhatsApp/AI consumers in the same governed business sweep.

## C2-10 — Legacy migration/cutover

Retire legacy `set_subscription_status`, `extend_trial_days`, manual WhatsApp-state writing and generic mutation paths only after replacement commands and client/runtime parity are proven.

## C2-11 — Commercial V2 acceptance

In addition to existing C2 evidence, verify:

- Merchant 360 shows consistent Business, Branch, team, commercial and account-state facts;
- one governed temporary restriction and restoration round-trip;
- suspension cannot be bypassed by a client that still has an active Branch subscription;
- account restoration does not silently reactivate an expired/unqualified Branch subscription;
- exceptional subscription extension is an audited event, not an expiry-date edit;
- ownership transfer remains separate from agreement acceptance;
- Merchant Web, Mobile and WhatsApp consume the same effective account/Branch state;
- AI can explain the state but cannot mutate it without approved authority;
- offline/replay cannot permanently bypass a restriction;
- legacy direct tenant-state mutation is no longer used by supported target flows.

# 16. QA gate

Before Merchant Management may be called complete, verify at minimum:

1. merchant estate discovery is server-bounded and paginated;
2. Merchant 360 reads fail closed without the required ProcessEdge identity/capability;
3. AAL1 is denied where Admin requires AAL2;
4. Support/read-only persona cannot execute sensitive account/commercial mutations without the exact capability;
5. account-state mutation requires valid Business scope, reason and idempotency where applicable;
6. restrict/suspend/restore/close actions write immutable audit evidence;
7. one Branch's commercial state remains independent from merchant account lifecycle history;
8. restriction/suspension affects Merchant Web, Mobile and WhatsApp consistently through shared authority;
9. restoration does not fabricate subscription, payment, setup, agreement or entitlement prerequisites;
10. direct subscription-status/expiry-date editing is unavailable in the target path;
11. exceptional extension uses the governed entitlement/commercial event;
12. ownership transfer preserves membership invariants and does not fabricate merchant agreement acceptance;
13. WhatsApp health cannot be faked by manually setting a status label;
14. historical merchant/account/commercial state remains explainable after intervention;
15. audit/reporting expose ProcessEdge actor/reason/effective dates;
16. offline/replay revalidates server authority and remains idempotent;
17. no client creates a separate account-state enum or entitlement rule that diverges from the shared resolver.

# 17. Anti-patterns

Do not:

- use subscription state as a merchant security/support account switch;
- use merchant account state as a replacement for Branch subscription truth;
- expose a generic Admin "force active" or "force healthy" control;
- let ProcessEdge fabricate merchant legal acceptance or provider payment evidence;
- let Merchant 360 become a second commercial/setup/channel engine;
- add direct database-edit controls for convenience;
- give Platform Support sensitive merchant mutations implicitly;
- treat support notes as business authority;
- delete merchant history when closing/restricting an account;
- declare Merchant Management complete while legacy direct-state mutation remains the supported target path.