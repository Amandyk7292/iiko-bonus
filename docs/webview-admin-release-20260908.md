# WebView administration restored

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
