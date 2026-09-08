# WebView administration restored

## Combined IPA 17 and consistent promotion borders

- Banner outlines now use the same gold, width and corner radius for every card,
  regardless of story view state. The slider no longer receives viewed-state data.
  Existing card gaps and soft shadows are unchanged. The 15 story/banner tests and
  analysis of the three affected Dart files passed.
- Source `36c12ba43b6b3993f710e53d8a61978aa0eb97fb` was published as website release
  `20260908204323-36c12ba43b6b`. Production/staging readiness and the public Flutter
  hash passed: `20e9d8719b8679fa776dea3b1da03c7341b31411412cd0daf938926a6d17ae64`.
  The database backup was verified and no SQL migrations were applied.
- Combined version 1.0.1 build **17** includes the Operations Center default,
  Live Activity updates/branding below, and consistent banner outlines.
  Actions run `34246575257`, artifact `10064509734`, completed successfully.
  Main app/widget bundle identities, signing profiles, device authorization and
  checksum passed local validation; the widget's compiled Assets.car is packaged.
- IPA SHA-256: `f0316e8476079ff0c016752803fc590389bcec4a4b96027bcd707af28e9cd32d`.
  Install file: `%LOCALAPPDATA%/Bulka/builds/Bulka-profile-f0316e847607.ipa`.
- **Installed at 20:59:19 local time:** the original Amandyk iPhone was reconnected
  and the installation proxy reported success. A separate installed-app query
  confirmed version **1.0.1, build 17** for `com.bulka.bonus`. The local IPA checksum
  and build identity were rechecked before installation.
- Native launch succeeded, and a device screenshot confirmed the app rendering a
  promotion story. Startup registered a fresh Live Activity for order 100012 in
  the correct sandbox environment at `2026-09-08T16:00:30.479Z`.
  The lock-screen white logo/icon layout has not yet been visually observed;
  APNs acceptance and successful registration alone do not establish that result.

Evidence: `scratch/banner-border-deploy.log`, `scratch/banner-border-tests.log`,
`scratch/verified-iphone-ipa.json`, `scratch/ios-artifact-10064509734.zip`,
`scratch/iphone-build17-install.log`, `scratch/iphone-build17-after-app.json`,
`scratch/iphone-build17-first-launch.png`.

## Live Activity synchronization and branding, evening update

- Source `03383f8d712f` was published as website release
  `20260908203520-03383f8d712f`. Production/staging readiness and the public Flutter
  hash passed: `54552d54dca22892c0faf77c041b69bacb338a65fff354dc7978ec6d2b262a08`.
- The production APNs credentials were missing. The existing Apple Developer
  push key was verified and configured securely; no private key is stored in Git.
- Development-signed profile IPAs previously registered Live Activity tokens as
  production because the app used `DEBUG` to choose the APNs environment. The
  native bridge now reads `aps-environment` from the embedded signing profile.
  Existing activity tokens are observed again after relaunch, and Flutter retains
  pending registrations across authentication/network failures.
- Order details now synchronize the displayed order to ActivityKit, and customer
  refreshes queue events received during an in-flight request. Token registration
  immediately sends the current server state. APNs sends are bounded to 10 seconds
  and report failures without logging push tokens; transient failures do not retire
  an otherwise valid registration.
- Apple accepted an update with the actual `preparing` state of order 100012
  (`HTTP 200`, sandbox). Only the confirmed registration environment was corrected;
  the order, payment and kitchen state were not changed. This proves APNs accepted
  the update, not that its lock-screen presentation was observed on the device.
- The Live Activity uses the official transparent Bulka asset rendered white,
  status-specific icons, and a separate ETA row. Native compilation/signing passed
  in Actions run `34245527505`; build 16 was not installed because the subsequent
  banner-border correction is included in the combined IPA 17 above.
- Verification: 25 focused Flutter tests, Flutter analysis, 794 backend tests
  passed (3 skipped); changed-file ESLint/Prettier passed. The previously documented
  unrelated formatting/size-budget failures remain outside this release.

Evidence: `scratch/live-status-deploy.log`, `scratch/live-status-flutter-tests.log`,
`scratch/live-status-flutter-analyze.log`, `scratch/live-status-clean-backend-tests.log`,
`scratch/live-activity-apns-proof.log`.

## Operations Center entry and verified iPhone build 15

- Default WebView entry now opens `/admin/operations?embedded=app`. Kitchen
  notification links still open the kitchen explicitly. No native admin migration.
- Website release `20260908195810-12619b12141a` passed readiness/staging checks and
  Flutter hash verification; no database migration was needed.
- Version 1.0.1 build **15**, bundle `com.bulka.bonus`, was installed on the original
  Amandyk iPhone over USB at **20:07:47**. The installation proxy reported success,
  and a separate installed-app query confirmed build 15. The same pre-install query
  also confirmed the earlier build 14, resolving the earlier record's uncertainty.
- Actions run `34241634940`, artifact `10062491189`, source `12619b12141a`.
  IPA SHA-256: `ed62a48a315d38e62b62deca786471db3cb1b4fef1b0c495976ba0d9fbb2a72b`.
  App/widget signing profiles and device authorization were verified.
- Portal/native targeted tests: 23 passed; Flutter analysis found no issues.
  Physical navigation inside the installed app was not separately observed.

Evidence: `scratch/iphone-build15-install.log`,
`scratch/operations-home-after-app.json`.

## Barters and story cube update, 18:51 local time

- Website release: `20260908184552-03c26836e5dc`; source `03c26836e5dc`.
  Database backup verified and `20260908190000_iiko_barter_people.sql` applied.
  Staging, production readiness and public Flutter/admin asset hashes passed.
- iiko Dashboard now includes Barters: outgoing invoices, goods, dates, amounts,
  blogger name annotations, grouping and native-capable Excel export.
  See [iiko-barters.md](iiko-barters.md) for source semantics and missing-name handling.
- Post-release live read verified 27 Aktau invoices (01–08 September),
  321,685.10 KZT, 161 item rows; 4 Astana invoices (01 August–08 September),
  38,732 KZT, 19 item rows. Both Excel exports generated successfully and the
  annotation table is readable through the production Supabase client.
- Story transition uses a convex outside cube with per-face progress/title/close
  controls. Flutter source `10d1ca51d9fdf60b9611f7feb37cb7653a3d8a6a`;
  GitHub Actions run `34228804323`, artifact `10057183256` succeeded.
- IPA version 1.0.1, build **14**, bundle `com.bulka.bonus`, icon `BulkaSolid`.
  SHA-256: `b84630cea797727666f964bb244f5e1cad924251cacc34055854b1c4163da333`.
  App/widget signing and device profiles verified. USB installation reached 100%
  and reported `Installation succeed` at **18:51:14**.
- The iPhone disconnected before the subsequent installed-app query. Build 14
  is confirmed in the installed IPA's Info.plist, but an independent post-install
  device query and physical story gesture remain unverified pending reconnection.
- Verification: backend 789 passed / 3 skipped / 0 failed; admin 280 passed;
  targeted Flutter story/banner suite 15 passed. TypeScript, changed-file ESLint,
  API contracts, migration safety and admin build size checks passed. Browser
  probes and inspected screenshots cover 320, 390, 768 and 1280 px.
- The overall `verify` command is not fully green: existing Prettier violations
  in access/customer-order/order-images/payment-receipt files and existing size
  budget overruns in catalog_product_card.dart/login_screen.dart remain.
  Unrelated unfinished workspace edits were excluded from the release.

Evidence: `scratch/barter-release-verify.log`, `scratch/barter-deploy.log`,
`scratch/iphone-build14-install.log`, `scratch/iphone14-device-after.log`,
`scratch/barter-clean-backend.log`, `scratch/barter-clean-admin.log`,
`scratch/barter-browser-test.log`, `scratch/cube-convex.png`.

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
