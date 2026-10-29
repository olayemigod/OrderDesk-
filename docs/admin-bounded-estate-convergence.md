# Admin bounded estate convergence

This slice completes the active Admin shell's move away from the legacy full-merchant overview response. It does not deploy or remove the compatibility RPC used by unreachable legacy code.

## Read boundaries

- `platform_admin_bootstrap(actor)` returns only the administrator role, generation time, merchant count and legacy trial-record count.
- `platform_admin_operations_summary(actor)` returns aggregate WhatsApp connection states and current-period AI parser/metering facts. It does not return merchant rows.
- Billing and Communications discover merchants through `platform_admin_merchant_portfolio`, with server search, a maximum page size of 50 and keyset cursors.
- A Billing deep link resolves its selected merchant through the governed Merchant 360 read before loading the existing commercial authorities.
- AI readiness is derived from the aggregate operations response. The Edge Function no longer downloads and iterates over the merchant estate for this view.

All new RPCs remain service-role-only behind the MFA-protected `platform-admin` Edge Function. They preserve the distinction between merchant GMV, ProcessEdge commercial orders/confirmed collections and platform technical health.

## Policy preserved

The implementation introduces no installment due or grace rules, profit calculation, FX conversion, guarantee terms or refund semantics. Legacy trial records are reported only as compatibility data; no active trial offer or reachable legacy trial workflow is added. The ProcessEdge Business Dashboard decision was already recorded in the governing SellerTray skill, so no governing update was required.

## Validation

Admin contract tests cover the compact bootstrap, shared bounded selector and aggregate Operations path. Database coverage checks service-only grants, administrator authorization, governed counts and aggregate response structure. An isolated PostgreSQL runtime test exercises period filtering, WhatsApp counts, token totals, catalogue averages and metered order units against the real migration.

## Remaining Admin scope

The compatibility `platform_admin_overview` action remains for unreachable legacy Admin code and mutation-response compatibility. Retiring that code safely belongs with the controlled legacy trial transition. Later bounded Admin phases include installment portfolio and collections operations, ongoing agreement management, guarantees/refunds once governed, deeper audit filtering/export, promotions and broader platform-service health.
