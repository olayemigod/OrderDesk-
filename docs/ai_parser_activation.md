# OrderDesk AI Parser Activation

S4B adds a private `order-parser` Edge Function and keeps the public WhatsApp webhook provider-neutral.

## Safety boundary

The AI parser may extract only:

- product wording
- quantity
- extraction confidence

It does **not** receive or return merchant selling prices. Pricing remains deterministic inside OrderDesk after extraction by matching the parser result against the tenant catalogue.

The webhook retains the conservative fallback parser whenever the AI service is unavailable, times out or returns an invalid response.

## Server secrets

Configure these directly in the Supabase project secret store. Do not place them in the repository, mobile `.env`, screenshots, support tickets or chat messages.

### Required to activate

- `OPENAI_API_KEY` — server-side OpenAI API credential used only by `order-parser`.
- `ORDER_PARSER_TOKEN` — a high-entropy shared secret used only for webhook → parser authentication.

### Optional

- `OPENAI_PARSER_MODEL` — defaults to `gpt-5.6-luna` for the cost-sensitive high-volume extraction workload.
- `ORDER_PARSER_URL` — normally unnecessary. When absent, `whatsapp-webhook` derives the internal project URL as `/functions/v1/order-parser`.

## Function security

`order-parser` is deployed with platform JWT verification disabled because it performs its own service-to-service bearer-token check. It fails closed:

- missing parser token or OpenAI key → HTTP 503
- wrong bearer token → HTTP 401
- invalid request → HTTP 400/413
- provider/schema failure → HTTP 502

`whatsapp-webhook` calls the parser only when `ORDER_PARSER_TOKEN` exists. Otherwise it continues directly to the deterministic fallback parser.

## Parser contract

Request:

```json
{
  "text": "I need 2 bags of rice and 3 bottles of oil",
  "catalogue": [
    {
      "id": "catalogue-uuid",
      "name": "Rice 50kg",
      "aliases": ["bag of rice", "bags of rice"]
    }
  ]
}
```

Response:

```json
{
  "items": [
    { "name": "bags of rice", "quantity": 2 },
    { "name": "bottles of oil", "quantity": 3 }
  ],
  "confidence": 0.94
}
```

The OpenAI call uses the Responses API with strict JSON Schema Structured Outputs. OrderDesk validates the provider response again before returning it to the webhook.

## Activation acceptance

After secrets are configured, send a **new** WhatsApp message with a unique Meta provider message ID. Verify:

1. `orders.parser_source = 'external'`
2. `orders.parser_version = 'external-v2-catalogue'`
3. parser confidence is within 0..1
4. catalogue-recognized lines receive the correct `catalog_item_id` and merchant selling price
5. original customer wording is retained on `order_items.original_item_name`
6. no price originates from the AI parser
7. duplicate delivery of the same Meta message ID still creates no duplicate order
8. disabling/removing parser activation secrets causes the webhook to fall back safely rather than failing inbound ordering

Do not mark S4B production acceptance PASS until this live activation test succeeds.
