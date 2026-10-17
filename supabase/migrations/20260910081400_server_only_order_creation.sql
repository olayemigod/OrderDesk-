-- WhatsApp orders are created by trusted server ingestion. The merchant app
-- may progress existing orders but cannot fabricate parser provenance by
-- inserting an order row directly.
revoke insert on table public.orders from authenticated;
