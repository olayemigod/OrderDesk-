// One tenant/phone routing truth for inbound WhatsApp webhook lookups.
// Never route historical retired or disconnected merchant mappings even
// when a valid legal consent record remains present for audit purposes.
export function activeWhatsAppTenantLookupQuery(phoneNumberId) {
  if (typeof phoneNumberId !== 'string' || phoneNumberId.length === 0) {
    throw new TypeError('WhatsApp phone number ID is required');
  }
  return '/rest/v1/tenants?select=id'
    + '&whatsapp_phone_number_id=eq.' + encodeURIComponent(phoneNumberId)
    + '&retired_at=is.null'
    + '&whatsapp_connection_status=eq.connected'
    + '&limit=1';
}
