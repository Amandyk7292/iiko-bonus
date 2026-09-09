# Android validation and client follow-up, 9 September 2026

Application source: **5d757919f74a**. Production release:
**20260909101134-5d757919f74a**. The standard deployment used a clean clone,
passed backup/migration/provenance gates and verified the published Flutter web
SHA-256 `08c8f7ceef413b1bd882ee4d9c03151561048881c560ab647202d8389b99df0e`.
Unrelated local administration and backup edits were excluded.

## Client changes

- Purchase cards show the actual order number at the upper right, beside the total.
- Products with missing/broken images share the photo-card layout: a square image
  area, favorite at the upper right, quantity control at the lower right, then
  price and name. Missing images use an outlined bakery placeholder.
- The order-type prompt has no repeated heading. Continue browsing is outlined;
  the yellow choose-order-type action remains.
- The first explicit cashier notification opt-in can request Android permission
  even when Firebase initially reports denied. Later denials remain respected.
- Ready pickup Live Activities expire one hour after kitchen readiness. Preorder
  pickups are included; delivery is excluded. Native foreground timers and the
  Android notification timeout use the fixed server deadline. The server sends
  the iOS ActivityKit end event even while the app is closed, polling once per
  minute. This does not complete, cancel or otherwise change the order.

## Emulator evidence

AVD: Medium_Phone_API_36.1, Android 16 / API 36.1, Google Play x86_64.
Package: `com.bulka.bonus`. Final tested app: **1.0.1 (24)**, debug x86_64;
this is an emulator artifact, not a universal release APK. APK SHA-256:
`a4c01bef5aecae0bc3ba406d6c66d176abb168314a00cd99af4bec7d6fdfd9ee`.

Build 23 first displayed the real Android notification permission dialog. After
Allow, POST_NOTIFICATIONS was granted and the notification onboarding card
collapsed. Native Firebase generated a token. With the app backgrounded, one
notification targeted only this emulator token and was visible in the Android
notification tray at **2026-09-09T04:57:17.566Z**. Firebase delivery receipt:
`projects/bulka-bonus/messages/0:1788929837503880%9b2836139b283613`.

This was a guest-device transport check, not a signed-in customer/cashier
registration check. No production customer broadcast or order/payment mutation
was used. The separate physical iPhone customer enrollment test is recorded in
`client-release-20260909.md`.

Build 24 was installed and launched. The no-photo category was visually checked:
aligned controls, prices and names. The duplicate-free prompt and visible
Continue browsing outline were inspected; Continue closed the dialog. Android
logs after the final clean installation contained no Flutter/AndroidRuntime
errors, and POST_NOTIFICATIONS remained granted.

The Windows emulator host crashed with its original Vulkan configuration. It
remained running with OpenGL software rendering and Vulkan disabled. An initial
incremental debug artifact reported an invalid Dart kernel; `flutter clean`,
dependency restoration and a fresh APK build resolved it. No application source
workaround for these local build/emulator issues was needed.

Local artifacts (ignored by Git):

- `scratch/android23-permission.png`
- `scratch/android23-permission-collapsed.png`
- `scratch/android23-push-delivered.png`
- `scratch/android23-push-delivery.log`
- `scratch/android24-cards.png`
- `scratch/android24-order-prompt-2.png`
- `scratch/android24-continued.xml`
- `scratch/android24-clean-build.log`

## Server lifecycle evidence and checks

After deployment, the expiry worker had **3 successful runs, zero failures** at
**2026-09-09T05:21:33.199Z**. The three previously active tokens for reported
order **100010** were retired at 05:18:44Z after the end dispatch. The order
remained paid/ready, with its original kitchen timestamp and unchanged updated_at.
This proves server execution/APNs acceptance; the physical lock screen was not
observed during this expiry check. Scheduling is within one worker interval of
the deadline, with eventual display subject to device/network delivery.

- 82 focused Flutter tests passed, including catalog interaction, purchases,
  permission recovery and Live Activity expiry/cache/foreground timer cases.
- 14 backend Live Activity tests and 19 kitchen/refund/delivery regression tests
  passed.
- Full Flutter analysis found one test-only style diagnostic, which was fixed;
  analysis of that file then passed. Backend ESLint and source-size budgets passed.
- Android build 24 and the production Flutter web/admin builds succeeded.
- Production and private staging readiness checks passed.

Evidence: `scratch/android-client-delta-tests.log`,
`scratch/android-live-activity-backend-tests.log`,
`scratch/android-order-regression.log`,
`scratch/android-client-analyze-fixed.log`,
`scratch/android-delta-source-size.log`,
`scratch/android-client-delta-deploy.log`, and
`scratch/live-activity-expiry-after.log`.

No new IPA was built for these follow-up UI changes. The physical iPhone still
has build 23; a later native iOS build is required for the new purchase/card/dialog
layout. The deployed server expiry already applies to existing ActivityKit tokens.
