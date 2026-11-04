export const BUSINESS_PROFILE_UPDATED_EVENT = 'sellertray:business-profile-updated';

export type BusinessProfileUpdatedDetail = {
  tenantId: string;
  name: string;
  logoUrl: string;
  currency: string;
};

export function publishBusinessProfileUpdated(detail: BusinessProfileUpdatedDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<BusinessProfileUpdatedDetail>(BUSINESS_PROFILE_UPDATED_EVENT, { detail }));
}
