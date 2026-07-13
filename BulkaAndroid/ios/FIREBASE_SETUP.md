# Firebase setup for iOS

The iOS app starts without Firebase credentials and disables push notifications gracefully. Push notifications require the real Firebase configuration before an App Store build.

1. Open Firebase Console and select the production Bulka project.
2. Register the iOS application with bundle ID `com.bulka.bulkaBonus`.
3. Download `GoogleService-Info.plist`.
4. Copy it to `ios/Runner/GoogleService-Info.plist` and add it to the Runner target in Xcode.
5. In Apple Developer, enable Push Notifications for the App ID and upload an APNs authentication key to Firebase.
6. In Xcode, confirm the Runner target has Push Notifications and Background Modes with Remote notifications enabled.
7. Run `flutter pub get`, then `cd ios && pod install` on macOS.

Do not commit `GoogleService-Info.plist`, APNs keys, signing certificates, or provisioning profiles.
