# iOS OTA releases

The first supported baseline is 1.0.6+41. Build 1.0.6+40 was built with stock Flutter and cannot receive Shorebird patches.

Run `iPhone device build` from main with mode `release`, distribution `appstore`, OTA enabled, and a new build number. This builds through Shorebird 3.38.5 and registers the exact release. Upload that workflow's IPA using `Upload iOS build to TestFlight`; customers must install the baseline once.

For a Dart-only fix, run `iOS OTA patch` with the exact installed release version and the staging track. Verify on a physical iPhone using the matching Shorebird release. Only then promote the verified patch to stable with `shorebird patches set-track` (see CLI help). Do not bypass native or asset difference checks. Native code, plugins, Flutter upgrades and bundled asset changes require a new store baseline.

SHOREBIRD_TOKEN is stored in GitHub Actions secrets. The initial key expires after 30 days; renew it in Shorebird and replace the repository secret before expiry. Never commit keys.

The default Shorebird updater checks at startup and applies a downloaded compatible patch on a subsequent launch. Do not promise instant replacement while the app stays open. See https://docs.shorebird.dev/code-push/update-strategies/.
