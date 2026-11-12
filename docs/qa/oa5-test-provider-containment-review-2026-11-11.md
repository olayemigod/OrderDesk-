# OA5 Test provider delivery containment — private evidence review, 11 November 2026

**Status: PREPARED, NOT ACCEPTED.** Pre-rebuild Test ingress/egress and provider-console reviews are **still open**. This repository addition is an **offline-only evidence checker**, not a provider integration, hosted configuration change or permission to pause cron jobs/reset Test. Scope **only** Supabase Test `iukgsukdoowvnhlfmpml`. Production `eujxswjspolugrzlsjnn`, live Meta phone numbers, Tandar, customers, and existing Production domains remain unchanged.

## Purpose and closure rule

The existing preflight has individual checklist items for Meta, Paystack, Flutterwave, SMTP/Auth, FCM, AI workers and Merchant/Admin domains. A checklist assertion alone cannot prove callback and recipient safety. This extra guard requires a **separate current private configuration review record per provider**. It rejects unknown/unreviewed provider modes, leaking URLs/keys/recipient data in metadata, ambiguous Test/Production routing, reused evidence references, non-quarantined external ingress or outbound delivery, and non-Test source SHA. It **does not** access any provider APIs or prove that console screenshots are true. It is an additional *precondition* for requesting a future operator authorization.

| Provider | Permitted pre-maintenance mode | Independent hosted/console acceptance required |
| --- | --- | --- |
| Meta/WhatsApp | Disabled, or isolated dedicated Test app/number with ingress and delivery quarantined | Confirm the former QA phone ID historical **Production mapping** does not grant Test routing; no Tandar/live phone/webhook reassignment; Test signer/app/phone ownership |
| Paystack | Disabled or sandbox-only but callback/delivery quarantined | Test-only key, webhook target and replay/duplicate-safe signature; Production live callback invariant |
| Flutterwave | Disabled or isolated sandbox; no delivery during maintenance | Disabled field or sandbox key/recipient/callback state, live paths unchanged |
| SMTP/Auth | Disabled or captive Test-only safe sink; activation/invitation ingress quarantined | Test sender and recipient allowlist, URL/redirect origin, no accidental real inbox |
| FCM | Disabled or QA Firebase project/device only; no push during maintenance | Test service account/project, QA device token only, no live handset target |
| AI/worker | Disabled or mock-only with zero external route/credential | Worker queue and `pg_net` count, runtime URLs absent, no external AI spend/sink |
| Merchant/Admin Auth redirect | Disabled or Test-domain-only, both ingress/delivery quarantined during maintenance | Existing protected Vercel Previews retained; test domains not bound until independently approved; Auth and password-reset deep links are Test-only |

**Important:** `disabled` means *no active Test route or credential*. Source files may still contain dormant integration code. Non-disabled QA modes require `destination:test_only` and `credentials:nonproduction_only`, except `ai_workers:mock_only`, which must have `destination:none` and `credentials:none`. Every mode still requires `ingress:quarantined`, `outbound:quarantined`. These attestations must reflect actual observed provider settings. If you cannot certify a channel, leave the gate blocked; do not manufacture a positive review.

## Private schema and offline check

Only securely stored, non-secret count/status assertions belong in the JSON file. **Never commit provider screenshots, phone IDs, callback URLs, email addresses, API keys, webhooks or tokens to the repository.** The checker requires exactly these top-level fields:

`schema_version:1`, `project_ref:iukgsukdoowvnhlfmpml`, `purpose:oa5-pre-rebuild-external-provider-containment`, `reviewed_source_sha:<exact 40-char Git SHA>`, `captured_at_utc:<UTC Z timestamp within 24h>`, `production_unchanged_reviewed:true`, `production_invariance_evidence_ref:<opaque private ref>` and `providers` with **seven** keys named above in code: `meta_whatsapp`, `paystack`, `flutterwave`, `smtp_auth`, `fcm`, `ai_workers`, `merchant_admin_auth_redirects`.

Every provider entry requires exactly: `mode`, `ingress`, `outbound`, `destination`, `credentials`, `production_unchanged:true`, `no_real_recipient:true`, `provider_owner_reviewed:true`, and a **unique opaque** `evidence_ref`. A provider review must originate from independent provider-console/config owner evidence. Evidence refs may not be shared between any two channels or the overarching Production-invariance review.

Run only after securely collecting **real** provider-side evidence; never mark unverified fields `true`:

```sh
node scripts/qa/oa5-test-provider-containment.mjs --check /secure/private/fresh-provider-containment.json
```

The combined Test rebuild preflight now expects this file **after** the historical Auth lineage snapshot and **before** the optional one-session-loss review file. Refer to the newest command at the top of `docs/qa/oa5-test-rebuild-operator-preflight-2026-11-09.md`. The checker validates the record's shape, date, exact source and claimed policies; a `provider_review_record_consistent:true` result is **not** independent proof of actual provider-console configuration, 4-cron freeze, zero network delivery, historical Preview reviewer access, managed Auth/Storage recovery, or permission for any hosted operation.

## Decision gate and next step

Until actual Meta/PSP/SMTP/FCM/AI/Vercel provider-owner reviews exist, mark **external provider isolation OPEN / NO-GO**. This repo code cannot satisfy those approvals alone. After independently confirming protected previews, Test Auth/Storage plan, exact supported cleanup method, archive restore, and Production invariance, request a **specific four-Test-cron reversible pause approval**, then immediately capture fresh all-age cron and `pg_net` quiescence and obtain separate operation-specific Test-only reconstruction permission. Never pause, deploy, reset, send, remove Auth identities, or change a live callback as part of this read-only/source QA batch. C2 Production migration and Build 47 remain separately gated.

Test verification: Node 22's `node --test scripts/qa/oa5-test-provider-containment.test.mjs` covers seven standalone provider boundaries, disabled and sandbox-mode semantics, changed source/project, timestamp, repeated evidence, confidential fields, missing private file, and persistent NO-GO outputs. GitHub OA5 Isolation runs it along with the combined preflight regression tests. No new SQL migrations, mobile APK, Vercel Preview, database write or provider charges are required by this slice.

## 12 Nov 2026 — Production-legacy Meta phone collision: test ingress fail-closed

A separate **read-only** Production census (no tenant/user names or private credential bytes retrieved) found the former proposed QA Meta phone `1271836092686870` in **one** Production connection row **and one** Production Business legacy `whatsapp_phone_number_id` reference. The connection itself reports `disconnected` but lacks a disconnect timestamp and has unknown webhook subscription status. There is no retained private credential row for this connection. Meta Console ownership and delivery routes remain independently unproved.

The draft Test-specific webhook guard previously accepted that same ID as safe. This has been corrected **in source only** to deny Test GET verification and signed POST payloads until an independent, nonoverlapping Test phone ID is provider-attested and source-approved. The Production/local paths remain unchanged. **Test WhatsApp acceptance is intentionally blocked**, not silently considered passed. Do not release a Test Meta callback/phone assignment or update Production's legacy Business references without separately approved provider work.

No Meta API, Production SQL write, Test migration, webhook redeploy, phone registration, outbound message or Tandar change occurred.
