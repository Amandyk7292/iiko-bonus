# Firebase setup for iOS

The Firebase iOS app is active with bundle ID `com.bulka.bonus`, and
`GoogleService-Info.plist` is included in the Runner resources.

1. In Apple Developer, enable Push Notifications for App ID `com.bulka.bonus` under team `GKRRT4JU9G`.
2. Firebase Cloud Messaging has the APNs authentication key configured for both Development and Production with Key ID `5UG437FF37` and Team ID `GKRRT4JU9G`.
3. In Xcode, confirm the Runner target has Push Notifications and Background Modes with Remote notifications enabled.
4. Run `flutter pub get`, then `cd ios && pod install` on macOS.

Do not commit `GoogleService-Info.plist`, APNs keys, signing certificates, or provisioning profiles.
