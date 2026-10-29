# SellerTray Admin Capability & RBAC Governance

Status: **Normative extension of `SKILL.md` for every SellerTray Admin Web, platform-operations, commercial-admin, privileged-support or internal-role task**

This extension governs ProcessEdge-internal access to SellerTray Admin. It complements `COMMERCIAL.md` and does not weaken merchant Owner/Manager/Cashier permissions. For agreement-specific behavior, the later universal Master Agreement contract in `AGREEMENTS.md` controls.

## Governing rule

> Admin roles are human-facing responsibility bundles; server-governed capabilities are the authorization authority.

SellerTray Admin currently recognises broad ProcessEdge personas such as **Platform Admin** and **Platform Support**. Those labels may remain useful for navigation, staffing and default access bundles, but privileged actions must not depend on browser labels or a single coarse `admin` boolean forever.

The long-term model is:

1. authenticated ProcessEdge identity;
2. required MFA/AAL2 for SellerTray Admin access;
3. active internal role/bundle assignment;
4. explicit server-side capability check for the requested read/mutation;
5. tenant/Business scope where applicable;
6. reason/evidence requirement where applicable;
7. immutable privileged-action audit.

## Separation from merchant roles

Do not mix ProcessEdge Admin roles with merchant roles.

Merchant roles remain merchant-domain authority such as:

- Owner;
- Manager;
- Cashier.

ProcessEdge internal personas/capabilities govern cross-tenant platform work. A ProcessEdge Platform Admin is not automatically a merchant Owner and must not bypass merchant-domain commands by writing merchant truth directly.

When Admin performs an approved platform/commercial action affecting a merchant, use the governed administrative command/RPC/service that preserves the same underlying business invariants, audit, idempotency and history.

## Current broad personas

The initial broad personas remain:

### Platform Admin

Default intent: authorised ProcessEdge staff responsible for privileged platform/commercial administration.

Platform Admin may receive mutation capabilities, but possession of the persona label alone is not sufficient long-term authority for every sensitive action. The server must verify the relevant capability.

### Platform Support

Default intent: ProcessEdge support/operations staff who need broad visibility and bounded support tools without unrestricted commercial or platform mutation.

Support is **read/review first**. A Support user may mutate only when an explicit approved capability grants that operation. Do not infer commercial authority from support access.

### Future internal personas

SellerTray may later introduce responsibility-oriented bundles such as Finance, Commercial Operations, Platform Operations, Auditor or Leadership. These are **bundles over capabilities**, not new business-truth engines.

Do not hard-code UI behavior around speculative future role names. Capability checks must allow bundles to evolve without rewriting the underlying command authority.

## Capability families

Use stable semantic capabilities or an equivalent governed representation. Exact database identifiers may be adapted to the existing schema after inspection, but they should preserve these boundaries.

### Business performance

- `admin.business_dashboard.read`
- `admin.business_dashboard.export` where export exists
- `admin.business_dashboard.financial_detail.read` for sensitive ProcessEdge financial detail if later separated

The Business Dashboard remains server-calculated from governed commercial/reporting facts. Capability checks must not cause the browser to reconstruct revenue, collections or GMV locally.

### Merchant estate

- `admin.merchants.read`
- `admin.merchant_detail.read`
- `admin.merchant_support.manage` for bounded support metadata/actions
- `admin.merchant_ownership.transfer` for governed Business ownership correction/transfer

`admin.merchant_ownership.transfer` is a sensitive mutation capability. It must remain distinct from ordinary merchant read/support authority, must support tenant scope, requires MFA/AAL2 at the Admin transport, requires a reason and idempotency command identifier, and must write immutable membership plus Platform Admin audit evidence. Platform Support does not receive it by default.

Merchant discovery must remain paginated/bounded. Capability assignment is not permission to download the full merchant estate into browser memory.

### Commercial reads

- `admin.commercial.read`
- `admin.installments.read`
- `admin.payments.read`
- `admin.agreements.read`
- `admin.guarantees.read`
- `admin.pricing.read`
- `admin.promotions.read`

### Commercial mutations

Separate sensitive mutations rather than one universal `commercial.manage` switch where practical:

- `admin.pricing.manage`
- `admin.promotions.manage`
- `admin.installments.manage`
- `admin.payments.reconcile`
- `admin.agreements.publish`
- `admin.guarantees.manage`
- `admin.refunds.decide`
- `admin.entitlements.manage`
- `admin.branch_setup.manage`

`admin.agreements.publish` is platform-scoped legal publication authority for a new immutable universal SellerTray Master Agreement version. It is not merchant-specific issuance/replacement authority. A published version applies identically to every SellerTray Business when effective; Admin may review Business acceptance status but must not manufacture acceptance on behalf of a merchant.

A later implementation may group some capabilities where operations are inseparable, but do not collapse unrelated financial/legal powers merely for frontend convenience.

### Communications

- `admin.communications.read`
- `admin.communications.publish`

Publishing merchant-facing communication is a mutation and must be separately controllable from simply reading campaign history.

### Platform operations

- `admin.operations.read`
- `admin.operations.diagnostics.run`
- `admin.ai.diagnostics.run`
- `admin.whatsapp.operations.manage` where platform-level WhatsApp intervention is approved

Read-only health visibility and active probes/mutations are distinct capabilities.

### Audit

- `admin.audit.read`
- `admin.audit.export`

Audit authority must not imply permission to mutate the records being audited.

### Platform settings

- `admin.settings.read`
- `admin.settings.manage`

Only true platform-level settings belong here. Merchant business configuration stays in Merchant Web/shared merchant authority.

## Initial bundle expectations

The following is the intended **direction**, not permission to bypass current tested behavior during migration:

| Capability family | Platform Admin | Platform Support |
| --- | --- |
| Business Dashboard read | Default yes | Default yes where support needs platform context |
| Merchant estate/detail read | Default yes | Default yes |
| Merchant ownership transfer | Eligible by capability | No by default |
| Commercial read | Default yes | Default yes |
| Pricing/promotions mutation | Eligible by capability | No by default |
| Installment/payment reconciliation mutation | Eligible by capability | No by default |
| Master Agreement publication | Eligible by capability | No by default |
| Guarantee/refund decision | Eligible by capability | No by default |
| Communications read | Default yes | Default yes where assigned |
| Communications publish | Eligible by capability | Explicit grant only |
| Platform health read | Default yes | Default yes |
| Active diagnostics/probes | Eligible by capability | Explicit grant only |
| Audit read | Default yes | Bounded/assigned read |
| Audit export | Eligible by capability | Explicit grant only |
| Platform settings mutation | Eligible by capability | No by default |

During migration from the current `admin | support` checks, preserve approved existing behavior until the corresponding capability gate is implemented and tested. Do not silently remove a current legitimate support workflow or broaden it.

## Server-side enforcement

1. The browser may use capabilities to hide/disable unavailable controls, but the server remains authoritative.
2. Every privileged command must derive the actor from verified authentication; do not accept an arbitrary actor ID from the client as authority.
3. SellerTray Admin requires MFA/AAL2 for privileged portal access unless a later approved security policy explicitly changes it.
4. A service-role backend may execute privileged SQL/RPCs only after verifying the requesting ProcessEdge identity and capability.
5. Service-role credentials must never be exposed to Admin Web.
6. Direct browser writes to protected commercial/platform tables are prohibited.
7. Capability denial must fail closed even if the UI accidentally exposes the button.

## Scope and tenant boundaries

Capabilities answer **what** an internal user may do. Scope answers **where** they may do it.

The authority model must be able to support, when required:

- all SellerTray merchants;
- selected merchant/Business scope;
- read-only global scope with narrower mutation scope;
- temporary/incident-specific scope with expiry where later approved.

Do not assume every internal user with a capability automatically has unrestricted cross-tenant scope.

The MVP may initially use global ProcessEdge scope for a small trusted team, but the data model should not make future scoping impossible.

Master Agreement publication is intentionally platform-scoped rather than tenant-scoped because one published version applies to every SellerTray Business. Business context is relevant only when reviewing acceptance status/history.

## Sensitive action classes

The following require explicit capability checks and immutable audit. Require a reason when the action changes commercial/legal/financial state or where the existing governed command already requires one:

- Business ownership transfer/correction;
- plan/price/promotion changes;
- merchant-specific commercial overrides;
- installment/payment reconciliation or correction;
- entitlement release/suspension/override;
- universal Master Agreement version publication;
- guarantee decision;
- refund decision/processing;
- Branch setup readiness changes;
- platform-level WhatsApp intervention;
- platform settings changes;
- other actions defined as privileged by later governance.

A reason is not an authorization mechanism. Both capability and valid command invariants remain required.

## Business Dashboard and revenue access

Admin Overview / ProcessEdge Business Dashboard must keep these concepts separate:

- ProcessEdge cash collections;
- commercial order value;
- recognised revenue when an approved recognition authority exists;
- merchant GMV;
- merchant returns/refunds;
- platform usage/adoption;
- technical/service health.

Capabilities may limit access to sensitive financial detail, but they must not redefine the metrics.

Do not:

- label confirmed collections as recognised revenue merely because the viewer has Finance/Admin access;
- aggregate currencies without approved FX authority;
- derive profit without authoritative cost/expense policy;
- let a role-specific browser calculation become a second reporting truth.

Platform Operations owns technical/service health. Business Dashboard owns ProcessEdge business performance. A capability system should control access to those domains without mixing their semantics.

## UI behavior

1. Navigation may be capability-aware, but hiding a section is secondary to server authorization.
2. If a user can read a section but cannot mutate it, present a clear review-only state rather than generic disabled controls with no explanation.
3. A selected merchant/Business context must remain visible for merchant-scoped Admin actions.
4. Sensitive confirmation dialogs must state the business effect and required reason where applicable.
5. Do not expose internal capability codes as the primary user-facing language; use responsibility-oriented labels while preserving inspectable capability detail in appropriate administration/audit surfaces.
6. The Agreements workspace is platform-scoped for publication and merchant-scoped only for acceptance review. It must not expose bespoke merchant agreement issuance/replacement actions.

## Capability administration boundary

Do not casually add a self-service "make me admin" or browser-only role editor.

When internal capability assignment is implemented, it must include:

- authorised assignment authority;
- actor and target identity;
- capability/bundle before/after state;
- optional scope;
- effective timestamp;
- expiry where supported;
- reason;
- immutable audit;
- prevention of accidental lockout of the last authorised platform administrator where applicable.

The exact bootstrap/super-admin recovery model requires explicit implementation design before broad internal-role management is exposed.

## QA gate

For any Admin slice that adds or changes a privileged action, verify at minimum:

1. unauthenticated -> denied;
2. AAL1 when AAL2 is required -> denied;
3. authenticated but non-ProcessEdge/non-platform member -> denied;
4. valid member without capability -> denied;
5. valid member with read capability -> read succeeds;
6. read-only persona cannot mutate without the specific mutation capability;
7. valid mutation capability -> governed command succeeds;
8. tenant/Business scope is enforced where applicable;
9. actor identity cannot be spoofed from the request body;
10. sensitive reason/evidence requirements are enforced server-side;
11. privileged mutation writes an immutable audit event;
12. retry/idempotency remains correct for commands that can be retried;
13. UI accurately reflects review-only vs actionable state;
14. audit/export permissions are tested separately from ordinary reads.

For Master Agreement publication specifically, also verify platform-global scope, immutable version content/hash, AAL2 transport enforcement, `admin.agreements.publish`, publication audit, identical current version across Businesses, and absence of merchant-specific issuance controls.

## Implementation sequence

Use this sequence unless a later explicit decision changes it:

### A-CAP0 — Capability authority inventory

- enumerate current `admin | support` checks across Admin Web, Edge Functions and RPCs;
- map each current read/mutation to a semantic capability;
- record existing Support behavior before changing it;
- identify current platform membership/role authority and migration constraints.

### A-CAP1 — Capability model

- add governed internal capability/bundle representation;
- preserve MFA/AAL2 and existing platform membership;
- add server helper(s) for capability + scope checks;
- add immutable assignment/change audit;
- seed/migrate current Platform Admin and Platform Support behavior without privilege escalation.

### A-CAP2 — Read surfaces

- Business Dashboard;
- Merchant Portfolio / Merchant 360;
- Billing & Commercial reads;
- Platform Operations reads;
- Audit reads/exports.

Move each to explicit capability checks while preserving bounded server-side read models.

### A-CAP3 — Privileged mutations

Migrate commercial, communications, diagnostics and platform-settings mutations from coarse role checks to the correct capability checks. Do not combine unrelated powers into one convenience permission.

### A-CAP4 — Internal role administration

Only after the capability model is proven, add a governed ProcessEdge staff/bundle assignment experience if needed.

### A-CAP5 — Security acceptance

- Admin/support bundle regression;
- missing-capability tests;
- scope tests;
- AAL2 tests;
- audit tests;
- lockout/recovery controls where role administration exists;
- hosted/production acceptance before expanding internal access.

## Anti-patterns

Do not:

- treat `actorRole === 'admin'` in React as sufficient security;
- expose service-role credentials to the browser;
- make Platform Support equivalent to Platform Admin because both can open Admin Web;
- give one role all financial, legal, support and infrastructure mutations by convenience unless explicitly approved;
- duplicate merchant Owner/Manager/Cashier permissions as ProcessEdge roles;
- bypass governed merchant/commercial commands with direct Admin table writes;
- hide a button and call the action secured;
- let Audit read permission imply mutation permission;
- use capability filtering to change metric definitions or transaction truth;
- implement new privileged Admin mutations without adding a capability decision and audit requirement;
- issue or replace merchant-specific agreements in Admin after the universal Master Agreement model is active.

## Completion reporting

Every Admin implementation report must state:

- ProcessEdge persona(s) affected;
- capability/capabilities required;
- read vs mutation authority;
- tenant/global scope;
- MFA/AAL2 requirement;
- server enforcement point;
- audit behavior;
- UI review-only/actionable behavior;
- tests for allowed and denied paths;
- whether the change affects merchant-facing surfaces under `CROSS_SURFACE.md`.
