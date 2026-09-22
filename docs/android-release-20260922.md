# Android release 1.0.8

Use version code **2026091402**. Google Play's library already contains code
2026091401 as well as 33; incrementing 33 alone would not upgrade every older
installation. Keep the shared Flutter version at 1.0.8+43 for the iOS OTA base.

For a clean worktree, set `BULKA_ANDROID_SIGNING_PROPERTIES_FILE` to the existing
private signing properties file. Gradle reads it in place, and relative keystore
paths resolve against its directory. No passwords or keystore copies belong in
the worktree or repository. Incomplete signing configuration cannot build a
release artifact.

Build from `BulkaAndroid`:

```powershell
flutter build appbundle --release --build-name=1.0.8 --build-number=2026091402 --dart-define=BULKA_API_BASE_URL=https://bulka.com.kz
```

Before the next release, check the Play library and use a strictly greater unused
code. Verify the bundle signature and compare its signer with the accepted build.
