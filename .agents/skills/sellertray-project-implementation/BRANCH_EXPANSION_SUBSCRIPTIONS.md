---
name: sellertray-branch-expansion-subscriptions
description: "Normative Commercial V2/C2 extension governing Branches added after a Business is already active, independent Branch subscription anniversaries, renewal, setup and acceptance."
metadata:
  author: ProcessEdge Solutions Limited
  product: SellerTray
  version: "0.1.0"
  status: governing-extension
---

# SellerTray Branch Expansion & Subscription Lifecycle Governance

## Status and precedence

This file is a normative extension of `SKILL.md`, `COMMERCIAL.md`, `COMMERCIAL_C1.md`, `COMMERCIAL_V2.md`, `ONBOARDING_ACTIVATION.md`, `AGREEMENTS.md`, `OA5_C2_SEQUENCE.md`, `CROSS_SURFACE.md` and `INTELLIGENT_IMPLEMENTATION.md`.

It records the later explicit ProcessEdge decision of 2026-10-30 for a Business that starts with one Branch and adds another Branch later. It makes the already-approved Branch-owned Commercial V2 architecture explicit for staggered Business expansion and adds a mandatory C2 acceptance scenario.

Where older wording could be read as requiring all Branches to share the first Branch's subscription term, renewal date or activation lifecycle, this file controls.

## 1. Core rule: a later Branch is a new subscription subject

A Branch created after a Business is already operating is not an increment to a Business-wide subscription and must not inherit another Branch's subscription period merely because both Branches belong to the same Business.

Example:

- Business begins with Ikeja Branch in March 2026;
- Ikeja purchases and activates its own Branch subscription;
- Business adds Lekki Branch in September 2026;
- Lekki enters its own governed Branch commercial/setup lifecycle;
- Ikeja remains unchanged and operational while Lekki is purchased, paid, set up and activated.

The canonical model remains:

> Business -> Branch -> Branch Subscription -> Plan Profile Version -> Resolved Entitlements

## 2. Independent plan and billing-cycle selection

A newly added Branch may select an eligible Plan Profile and billing cycle independently of existing Branches.

For example:

- Ikeja -> Growth -> yearly;
- Lekki -> Starter -> monthly.

Do not force the new Branch onto the existing Branch's plan, cycle or commercial terms merely for Business-level uniformity.

Plan eligibility, price, tax, setup charge, installment policy, discounts/overrides and add-ons are resolved from governed authority for the new Branch purchase at the relevant commercial timestamp.

## 3. Independent subscription anniversary and term

By default, each Branch owns its own effective subscription period and renewal anniversary.

If Ikeja activates on 15 March 2026 for one year and Lekki activates on 20 September 2026 for one month, their subscription periods remain independent. The Business does not have one canonical renewal date.

Rules:

1. Do not automatically co-terminate a later Branch to the first Branch's renewal date.
2. Do not automatically prorate a later Branch back to the first Branch's anniversary.
3. Do not shorten or extend another active Branch merely because a new Branch is added.
4. Business-level subscription/renewal status is an aggregate read model over Branch subscriptions.
5. A future optional **Align billing dates** capability may be introduced only through an explicitly approved proration/credit policy and governed commercial order. It is not the default C2 behavior.

## 4. No invented proration

Commercial V2 already prohibits invented mid-cycle proration. This rule applies explicitly to Branch expansion.

Adding a Branch after Business activation must not create hidden arithmetic such as charging September-to-March solely to align with an existing March renewal unless ProcessEdge later approves a formal co-term/proration policy.

If proration is introduced later, it must define at minimum:

- eligible scenarios;
- authoritative day/month calculation;
- inclusive/exclusive tax treatment;
- rounding;
- discounts;
- credits/refunds;
- installment interaction;
- guarantee treatment;
- invoice/receipt evidence;
- renewal lineage;
- cancellation handling;
- audit and idempotency.

Until that policy exists, full independent Branch terms are the approved behavior.

## 5. Later-Branch purchase lifecycle

For an already-active Business adding a Branch, Merchant Web must support a governed flow conceptually equivalent to:

> Add Branch -> choose eligible Plan Profile -> choose billing cycle -> resolve subscription/setup/tax/adjustments -> create governed commercial order -> satisfy current agreement requirement -> confirm Branch-specific Order Form -> settle qualifying amount -> schedule/complete Branch setup where required -> derive Branch readiness -> reconcile Branch entitlement -> activate Branch

The exact UI may evolve, but the authority sequence must remain shared-core governed.

Creating the Branch record alone must not grant paid operational entitlement.

## 6. Existing Branch isolation during expansion

The lifecycle of the new Branch must not disrupt independently qualified Branches.

A new Branch that is:

- awaiting plan selection;
- unpaid;
- partially settled;
- waiting for setup;
- setup scheduled;
- unready;
- suspended;
- expired;
- blocked by its own commercial exception;

must not disable or downgrade an existing Branch whose own subscription and entitlement remain valid.

Cross-Branch blocking is permitted only where a separate Business-wide safety/legal rule genuinely applies and that rule is explicitly governed; it must not be inferred from subscription ownership.

## 7. Branch setup pricing and readiness

A later-added Branch gets its own governed Branch setup obligation where setup applies.

The applicable setup price is resolved from the effective-dated Branch Setup Pricing authority at purchase time and snapshotted on the commercial order. It does not reuse or rewrite the setup price paid by an earlier Branch.

Setup completion/readiness remains Branch-specific. A pending new Branch must not reopen or invalidate setup readiness of an existing active Branch.

## 8. Renewal behavior

Renewal is Branch-specific and must create governed commercial history rather than editing an expiry field directly.

At renewal:

1. target the exact Branch subscription;
2. resolve the applicable Plan Profile/version treatment;
3. resolve the effective governed renewal price/tax/eligible adjustments;
4. create a renewal commercial order or equivalent governed renewal instrument;
5. preserve payment/settlement evidence;
6. confirm any purchase-specific Order Form/document requirement;
7. reconcile the next Branch entitlement period idempotently;
8. preserve the prior subscription/order period as immutable history.

A renewal of Ikeja must not renew Lekki automatically, and vice versa.

## 9. Price/version treatment at renewal

Historical purchases retain their original immutable plan/price/tax snapshots.

When a published Plan Profile or price changes, the merchant's next Branch renewal follows the explicit subscriber-treatment policy already required by Commercial V2, such as:

- grandfather existing subscriber terms;
- migrate at renewal;
- apply an authorised merchant-specific recurring override;
- another explicitly governed treatment.

Never recompute the historical March purchase using the price effective at a later September or March renewal.

## 10. Agreement and Order Form behavior

Master Agreement acceptance remains Business/version-scoped under the current universal Master Agreement architecture.

When a later Branch is added:

1. if the Business has already accepted the currently required Master Agreement version, do not require duplicate Master acceptance merely because the new Branch is being purchased;
2. the new Branch purchase still receives its own immutable commercial Order Form / applicable Agreement Package evidence;
3. if a newer required Master Agreement version applies at the time of the new purchase or renewal, require the authorised Business acceptance before the governed service-delivery commitment that depends on it;
4. preserve all prior acceptance and Order Form evidence unchanged.

## 11. Billing Center / Merchant Web projection

Merchant Web subscription management must represent Branches independently and aggregate them at Business level.

At minimum, an authorised merchant should be able to see for each Branch:

- Branch;
- Plan Profile/version;
- billing cycle;
- subscription status;
- effective period;
- next renewal/expiry date;
- current paid/outstanding commercial state where relevant;
- setup/readiness state when applicable;
- usage/limits where implemented;
- actions such as purchase, renew, manage or change plan according to authority.

The Business summary may show counts and the nearest upcoming renewal, but must not invent one Business-wide plan or renewal date.

## 12. Mobile behavior

Mobile may show the active Branch's current plan/status/renewal attention and securely hand authorised users to Merchant Web for purchase/renewal management.

Mobile must not:

- calculate SellerTray subscription price locally;
- create co-term/proration arithmetic;
- treat one Branch's expiry as Business-wide expiry;
- grant the new Branch paid entitlement before governed reconciliation.

## 13. Admin behavior

Admin Web must support Branch-specific commercial inspection/recovery without rewriting another Branch's subscription facts.

ProcessEdge commercial reporting should allow a Business to show mixed Branch states, plans, cycles and renewal dates. Any privileged extension, override or recovery remains capability-, scope-, reason-, MFA/AAL2- and audit-governed as applicable.

## 14. Reporting, notifications and automation

Subscription attention is Branch-specific.

Renewal/expiry notifications, reporting and any future automated renewal workflow must identify the exact Branch subscription subject. A notification such as "subscription expires soon" must not imply that the whole Business expires when only one Branch is affected.

Business-level dashboards may aggregate:

- active Branch count;
- pending Branch count;
- next renewal across Branches;
- outstanding commercial obligations;
- mixed Plan Profile distribution.

## 15. Offline, WhatsApp and AI

- Offline operational entitlement snapshots remain Branch-specific and are revalidated against the server on replay.
- WhatsApp selling consumes the selected/fulfilling Branch's entitlement; a pending new Branch must not disable WhatsApp commerce for another valid Branch.
- AI may explain Branch subscription state and upcoming renewal from governed facts but cannot invent proration, renewal, payment or entitlement state.

## 16. Mandatory C2 acceptance scenario: staggered Branch expansion

Commercial V2/C2 must not be accepted without a controlled staggered-expansion proof in addition to static mixed-Branch fixtures.

Required scenario:

1. Create/identify a controlled Business with Branch A only.
2. Purchase and activate Branch A under a governed Plan Profile and billing cycle.
3. Record Branch A's independent entitlement period and renewal date.
4. Advance the scenario to a later business date/controlled period and add Branch B after Branch A is already operational.
5. Verify adding Branch B does not modify, suspend or reprice Branch A.
6. Purchase Branch B under a different eligible Plan Profile and/or billing cycle.
7. Verify Branch B receives current effective subscription/setup/tax pricing without rewriting Branch A history.
8. Verify unchanged Master Agreement is not accepted twice; Branch B gets exact new Order Form/package evidence.
9. Leave Branch B pending setup/payment temporarily and verify Branch A remains fully operational.
10. Complete Branch B setup/readiness and activate it independently.
11. Verify Merchant Web, Mobile, Admin, reporting, WhatsApp and AI resolve the correct Branch-specific entitlement.
12. Verify Branch A and Branch B have independent renewal dates by default.
13. Renew one Branch and verify the other Branch's term is unchanged.
14. Verify renewal resolves the governed current/grandfathered price policy without altering historical purchase snapshots.
15. Replay purchase/payment/readiness/reconciliation commands and prove no duplicate commercial, payment or entitlement effects.

A suggested illustrative timeline is:

- Branch A starts in March;
- Branch B is added in September;
- each Branch keeps its own plan/cycle/anniversary unless a future explicit co-term policy is invoked.

## 17. Anti-patterns

Do not:

- model a later Branch as only `branch_count + 1` on a Business subscription;
- copy the first Branch's subscription dates into every later Branch;
- silently prorate a later Branch to an existing renewal date;
- force all Branches onto one Plan Profile or billing cycle;
- let a pending new Branch disable existing active Branches;
- mutate historical price/tax/setup snapshots when current pricing changes;
- require duplicate Master Agreement acceptance under the unchanged required version;
- renew multiple Branches by editing one Business-level expiry field;
- let client code calculate subscription/proration truth;
- declare C2 complete without staggered Branch-addition and independent-renewal proof.
