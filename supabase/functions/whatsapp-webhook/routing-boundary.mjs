// One tenant/phone routing truth for inbound WhatsApp webhook lookups.
// Never route historical retired or disconnected merchant mappings even
// when a valid legal consent record remains present for audit purposes.
export function activeWhatsAppTenantLookupQuery(phoneNumberId, includeDetails = false) {
  if (typeof phoneNumberId !== 'string' || phoneNumberId.length === 0) {
    throw new TypeError('WhatsApp phone number ID is required');
  }
  if (typeof includeDetails !== 'boolean') {
    throw new TypeError('WhatsApp tenant lookup detail mode must be boolean');
  }
  // Both consent preflight and actual ingestion MUST use the same active,
  // non-retired tenant boundary. The detailed projection is used only after
  // consent/phone checks and does not create a second routing authority.
  return '/rest/v1/tenants?select=' + (includeDetails ? 'id,currency,name' : 'id')
    + '&whatsapp_phone_number_id=eq.' + encodeURIComponent(phoneNumberId)
    + '&retired_at=is.null'
    + '&whatsapp_connection_status=eq.connected'
    + '&limit=1';
}
