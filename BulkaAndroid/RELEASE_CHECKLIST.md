# Bulka native release checklist

## Shared release gate

1. Run backend, admin, and Flutter checks.
2. Apply every pending migration before uploading a build.
3. Confirm that the cashier tablet receives paid orders; the cashier enters them in iikoFront manually.
4. Run `powershell -ExecutionPolicy Bypass -File ..\scripts\check-native-release.ps1`.
5. Verify account deletion at `https://bulka.com.kz/account-deletion` and in Profile → Personal data.

## Android / Google Play

1. Create the permanent upload keystore once and back it up offline.
2. Copy `android/key.properties.example` to the ignored `android/key.properties` and fill all four values.
3. Build: `flutter build appbundle --release --dart-define=BULKA_API_BASE_URL=https://bulka.com.kz`.
4. In Play Console enable Play App Signing, copy the **app signing certificate** SHA-256 fingerprint, and set it on the server as `ANDROID_APP_SHA256_CERT_FINGERPRINTS`.
5. Re-run the release gate, upload `build/app/outputs/bundle/release/app-release.aab`, complete Data safety, content rating, account-deletion URL, screenshots, and closed testing.
6. Test `https://bulka.com.kz/orders` with App Links verification on a physical device.

## iOS / App Store Connect

1. On macOS open `ios/Runner.xcworkspace`; select the Bulka Apple team and confirm bundle ID `com.bulka.bonus`.
2. Add Push Notifications and Associated Domains capabilities to the App ID. Release/Profile use `RunnerRelease.entitlements` (`aps-environment=production`).
3. Apple Team ID is `GKRRT4JU9G`; keep `APPLE_BUNDLE_ID=com.bulka.bonus` in the deployment environment.
4. Copy `ios/ExportOptions.plist.example`, then archive with Xcode or `flutter build ipa --release --export-options-plist=... --dart-define=BULKA_API_BASE_URL=https://bulka.com.kz`.
5. Complete App Privacy, age rating, review contact/demo instructions, screenshots, and TestFlight device testing.
6. Test `https://bulka.com.kz/orders` from Notes/Messages on a physical iPhone after installing the TestFlight build.

Store submission cannot be completed from Windows or without the private Android keystore, Apple Team/provisioning access, and the two store accounts.
