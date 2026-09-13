# SellerTray Mobile Brand Asset Specification

Status: required before release-candidate APK acceptance.

SellerTray currently has no approved mobile brand image assets committed. Do not ship Expo/default launcher branding.

## Required source assets

Commit approved production assets under `apps/mobile/assets/brand/`:

1. `icon.png`
   - 1024 × 1024 px
   - PNG
   - square launcher/store source
   - no transparent outer padding that makes the mark appear undersized

2. `adaptive-icon.png`
   - 1024 × 1024 px
   - transparent PNG foreground
   - important artwork kept inside Android adaptive-icon safe area
   - designed to work on the approved adaptive background colour

3. `splash-icon.png`
   - high-resolution transparent PNG
   - centred SellerTray mark for the launch screen
   - no text that becomes unreadable on small screens

## Expo configuration contract

After approval, `apps/mobile/app.json` must contain:

- `expo.icon = "./assets/brand/icon.png"`
- `expo.android.adaptiveIcon.foregroundImage = "./assets/brand/adaptive-icon.png"`
- `expo.android.adaptiveIcon.backgroundColor = "<approved SellerTray background colour>"`
- `expo.splash.image = "./assets/brand/splash-icon.png"`
- `expo.splash.resizeMode = "contain"`
- `expo.splash.backgroundColor = "<approved launch background colour>"`

The display name remains **SellerTray** and Android package remains `ng.processedge.sellertray`.

## Approval gate

The `sellertray_brand_assets` release gate must remain `pending` until the Product Owner approves the visual direction and the exact committed files.

A QA-only APK may be built before final brand approval for deep-link/device testing, but it must not be represented as the release candidate and must be rebuilt after approved assets are committed.
