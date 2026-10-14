from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one replacement anchor, found {count}: {old!r}')
    target.write_text(text.replace(old, new, 1))


# Keep the scanner on the existing SellerTray design tokens and avoid relying on
# React Native StyleSheet helpers that are not present in the pinned type surface.
replace_once(
    'apps/mobile/src/redesign/BarcodeScannerSheet.tsx',
    'backgroundColor: theme.colors.background',
    'backgroundColor: theme.colors.cloud',
)
replace_once(
    'apps/mobile/src/redesign/BarcodeScannerSheet.tsx',
    "scanGuide: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },",
    "scanGuide: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },",
)
replace_once(
    'apps/mobile/src/redesign/BarcodeScannerSheet.tsx',
    "lockedOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(16,42,67,0.62)', alignItems: 'center', justifyContent: 'center' },",
    "lockedOverlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(16,42,67,0.62)', alignItems: 'center', justifyContent: 'center' },",
)

replace_once(
    'apps/mobile/src/redesign/QuickProductCreateSheet.tsx',
    'backgroundColor: theme.colors.background',
    'backgroundColor: theme.colors.cloud',
)
replace_once(
    'apps/mobile/src/redesign/QuickProductCreateSheet.tsx',
    'borderColor: theme.colors.dangerBorder',
    'borderColor: theme.colors.danger',
)

# Product/UOM commands now delegate role semantics to one audited capability.
# Preserve the writable-subscription guard and test the shared capability rather
# than re-introducing duplicated literal Owner/Manager checks into each command.
test_path = Path('supabase/tests/sellertray_product_uom_management.test.sql')
test = test_path.read_text()
old = """      and lower(pg_get_functiondef(p.oid)) like '%owner%'
      and lower(pg_get_functiondef(p.oid)) like '%manager%'
      and lower(pg_get_functiondef(p.oid)) like '%orderdesk_subscription_can_write%'"""
new = """      and lower(pg_get_functiondef(p.oid)) like '%sellertray_user_can_manage_products%'
      and lower(pg_get_functiondef(p.oid)) like '%orderdesk_subscription_can_write%'"""
if test.count(old) != 4:
    raise SystemExit(f'Expected four stale role assertions, found {test.count(old)}')
test = test.replace(old, new)
test = test.replace(
    'product save command enforces management role and writable subscription',
    'product save command enforces shared product capability and writable subscription',
)
test = test.replace(
    'product active-state command enforces management role and writable subscription',
    'product active-state command enforces shared product capability and writable subscription',
)
test = test.replace(
    'UOM save command enforces management role and writable subscription',
    'UOM save command enforces shared product capability and writable subscription',
)
test = test.replace(
    'UOM delete command enforces management role and writable subscription',
    'UOM delete command enforces shared product capability and writable subscription',
)
test_path.write_text(test)
