# WhatsApp webhook

First OrderDesk ingestion slice for Meta WhatsApp Cloud API.

## Responsibilities

- Complete Meta's GET verification challenge.
- Verify every POST against `X-Hub-Signature-256` using the Meta App Secret.
- Resolve the OrderDesk tenant from the WhatsApp `phone_number_id`.
- Upsert the WhatsApp customer.
- Store each provider message idempotently.
- Parse text into draft line items.
- Create an OrderDesk order in `needs_review` state.

## Required server secrets

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `META_WEBHOOK_VERIFY_TOKEN`
- `META_APP_SECRET`

Optional AI parser adapter:

- `ORDER_PARSER_URL`
- `ORDER_PARSER_TOKEN`

The parser endpoint receives `{ "text": "..." }` and should return:

```json
{
  "items": [{ "name": "5kg Rice", "quantity": 2 }],
  "confidence": 0.94
}
```

If the AI parser is not configured or is unavailable, the webhook falls back to a conservative quantity/name parser and always leaves the order for merchant review.

## Deployment note

This function is a public webhook and therefore must be deployed with Supabase JWT verification disabled. That is safe only because the function implements its own Meta GET token verification and HMAC-SHA256 POST authentication before parsing or writing data.
