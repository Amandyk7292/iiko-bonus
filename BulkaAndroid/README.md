# Bulka customer app

Flutter application for the Bulka loyalty program on Android and iOS.

## Run locally

```powershell
flutter pub get
flutter run --dart-define=BULKA_API_BASE_URL=https://your-api.example
```

The fallback API URL is configured for the existing production service; pass `BULKA_API_BASE_URL` for staging or a different production domain.

## Quality checks

```powershell
flutter analyze
flutter test
```

The app supports Russian, Kazakh, and English. Changing the language in Profile updates the running interface and is retained locally.

## Android release signing

1. Create a protected upload keystore.
2. Copy `android/key.properties.example` to `android/key.properties`.
3. Set `storeFile`, `storePassword`, `keyAlias`, and `keyPassword`.
4. Run `flutter build appbundle --release`.

`key.properties` and keystores are ignored by Git. A release build fails clearly if they are not configured, preventing accidental debug-key publication.

## iOS

Archive on macOS using the intended Apple team and provisioning profile. The app requests only foreground location for nearby-bakery and pickup-point selection; its system permission messages are localized for RU/KZ/EN.
