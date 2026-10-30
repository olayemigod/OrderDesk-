# SellerTray Admin Visual Redesign V1

This boundary records the approved presentation baseline first established in PR #149 and converged with newer OA5C functionality in PR #158.

The redesign is presentation-only. Functional SellerTray authority continues to come from the current governed shared core, Admin capabilities, commercial/onboarding/agreement services and server-side enforcement.

## Preserved authority

- Existing Admin routes and legacy aliases.
- Existing two-level grouped navigation contract.
- Existing shell-level Merchant/Business context semantics.
- Existing ProcessEdge personas, capabilities, AAL2/MFA and server enforcement.
- Existing RPCs, commands, database schema and business calculations.
- Existing audit, idempotency, tenant isolation and commercial/onboarding/agreement authority.
- Existing approved SellerTray logo and favicon assets.

## Visual scope

- Admin shell presentation.
- Sidebar and submenu styling.
- Top bar and Merchant context presentation.
- Workspace spacing and hierarchy.
- Cards, panels, tables, filters, search, buttons and status treatments.
- Responsive presentation for narrow browser windows.
- Accessibility presentation including focus visibility and reduced motion.

## Preservation rule

New Admin functionality must be integrated into this redesigned presentation or an explicitly approved successor. Functional work, rebases, conflict resolution, cherry-picks and deployments must not restore a pre-redesign shell or older page composition.

No new business fact may be introduced merely to reproduce a mockup, and no approved visual baseline may be discarded merely because newer business logic is added.
