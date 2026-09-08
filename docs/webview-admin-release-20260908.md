# WebView administration restored

## Consolidated update, 17:36 local time

This section supersedes the earlier build 8 release record below.

- Published source: `bacc2c207d6f961f79d8230fe6a46079f70244b3`.
- Website release: `20260908173009-bacc2c207d6f`; readiness, staging and the public
  Flutter bundle hash passed. Database backup verified; no migrations applied.
- iPhone: version 1.0.1, build **13**, `com.bulka.bonus`, installed over USB at
  17:36:59. Installation proxy reported success and the installed-app query
  independently confirmed build 13. GitHub Actions run `34226338496` succeeded.
- IPA SHA-256 prefix: `3a9c725e0d8f`. Main app and widget identities, device profiles,
  signing certificate and artifact checksum verified before installation.

Included changes:

- One stationary yellow launch surface, matching the native splash logo size.
- Only the close button remains in the Flutter administration header.
- Excel/CSV/JSON exports use a trusted-origin, nonce-checked native share bridge.
  Normal browser downloads remain available. The native sheet handles saving or
  sharing; this does not automatically send a report to anyone.
- Kitchen alerts use the native audio session in the app; explicit mute persists.
  Ordinary browser audio keeps its gesture fallback.
- Kitchen has New, Accepted and Ready lanes, with accessible mobile tabs.
- Default orders exclude failed payments before pagination. Explicit payment
  diagnostics still include them. Mobile order values stack without squeezing
  badges or customer/details text into narrow columns.
- Granted permission cards fade and collapse over 300 ms, moving the next card
  upward. Denied cards remain. Reduced-motion settings skip the animation.
- Banner pages have a 16 logical-pixel gap and retain their 1080:480 ratio and
  existing resting alignment. Page/grid clipping no longer cuts off shadows.
- Shared card, button and avatar shadows have lower opacity, softer blur and
  reduced spread/offset. The stronger catalog floating badge uses the same token.

Icon evidence:

The legacy catalog plus `UIPrerenderedIcon` still produced a visible gradient in
builds 8 and 10. Build 13 uses the `BulkaSolid.icon` composition with a solid
`#FFB300` fill and glass, specular, shadow and translucency disabled. The icon
retrieved from SpringBoard after installation now has an essentially uniform
yellow interior; iOS retains a thin highlight around its outer mask. No claim is
made that OS edge effects are absent.

Verification:

- Clean release checkout: all 276 administration tests and TypeScript passed.
- Five browser order/kitchen action tests passed. Chromium and WebKit layout
  probes passed at mobile and desktop widths; these used mocked order data.
- Flutter native bridge/portal/startup checks passed; latest permission/banner
  suite: 20 passed. Flutter analysis: no issues.
- Rendered banner shadows inspected at rest and mid-swipe, with shadows enabled.
  No rectangular cutoff; the gap remains visible. Static shadow review covered
  Flutter and web CSS definitions, including shared tokens. This is not evidence
  that every screen has been physically inspected on every device.
- Device launch succeeded. Physical audible playback and opening the native
  report share sheet were requested from the user and remain unconfirmed here.

Local evidence is in `scratch/build13-install.log`, `scratch/iphone-build13-apps.json`,
`scratch/iphone-build13-icon.png`, `scratch/latest-ui-tests.log`,
`scratch/latest-ui-analyze.log`, `scratch/release-final-tests.log`, and
`scratch/all-fixes-deploy.log`. These local files are intentionally not committed.

The user canceled the native staff migration. The iOS/Android employee entry now
opens the existing `AdminPortalScreen` and the published web administration.
Native staff screens remain inactive source, not the employee entry.

## Changes

- Login and registration language selectors scroll with their page content.
- WebView initialization failure is reported after the first frame, avoiding a
  parent `setState` call during child construction.
- WKWebView and Android WebView allow staff audio playback without requiring a
  new gesture for each document. The web provider restores enabled audio silently
  on mount, page restoration and foreground visibility. A saved mute remains mute;
  ordinary browsers retain the gesture fallback if they block autoplay.
- iOS uses the renamed `BulkaFlatFFB300` icon catalog and the prerendered setting.
  Existing iOS/Android/web icon backgrounds are `#FFB300`; no gradient is baked in.
  Renaming the catalog refreshes the icon identity used by the installed bundle.

## Verification and release

- Web administration: all 271 tests passed; TypeScript check passed.
- Targeted Flutter portal/workspace tests: 23 passed. Customer widget tests also
  passed after the language layout change. Flutter analysis found no issues.
- Audio tests cover silent mount, page restoration, provider remount, explicit
  test tones, mute, broken audio graphs and kitchen alarm stopping.
- Android ARM64 profile APK built successfully (59.3 MB).
- Published website: `20260908164213-ed2c040430c2`; public readiness and Flutter
  bundle hash verified by the deployment script. No SQL migrations were pending.
- iPhone source revision: `4ec44701be7690abf359debd8808e3f6652a0f89`.
- GitHub Actions run `34222364313` passed, including the new icon-catalog check.
- IPA checksum begins `11f50da1e847`; app/widget identities, embedded profiles,
  device eligibility and signing certificate checked before installation.
- USB installation succeeded on 2026-09-08 at 16:55 local time. Installed-app
  query confirmed `com.bulka.bonus`, version 1.0.1, build 8.
- The actual appearance of iOS system-applied icon effects and audible alarm
  recovery on the physical phone require observation; source and automated checks
  alone are not proof of those physical results.

Unrelated unfinished backend/access/catalog changes in the shared workspace were
excluded. Deployment used an isolated checkout under LocalAppData, not Desktop.
