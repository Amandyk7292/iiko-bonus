# Cashier invitation in customer registration

The optional “Мне помог сотрудник” card is shown only on the new-customer profile
form, after phone verification. It resolves the invitation before selecting a
cashier and sends `cashierInviteToken` only when completing that registration.
The existing customer `referralCode` is independent. Removing an unavailable
cashier permits ordinary registration; submitting while lookup is pending is
disabled. Late lookup replies cannot restore a removed selection.

QR invitations use `https://bulka.com.kz/cashier-register?cashier=<64 hex>`.
This unassociated path keeps phone-camera links in the website even when an older
Bulka app is installed: older Android binaries claim `/profile` and do not support
cashier tokens. Guests open the registration form directly; authenticated accounts
remain on their profile. The trusted parser also preserves
`https://bulka.com.kz/profile?cashier=<64 hex>` and the existing
`bulka://profile?cashier=<64 hex>` scheme for future compatibility. Pending invitations expire
after 30 days, are refused for a stored customer identity, and are cleared on
successful registration, authenticated login/password reset, session restoration,
and logout. The backend still decides whether the account qualifies for a salary
reward; neither scanning nor the client UI grants money.

QR photo bytes are decoded locally and are never uploaded. The existing
`image_picker` camera path and a deferred pure-Dart decoder support JPEG/PNG with
byte/pixel limits. [zxing2](https://pub.dev/packages/zxing2) is a BSD-3-Clause pure
Dart library and adds no native plugin. The existing
[web image picker](https://pub.dev/packages/image_picker_for_web) uses camera
capture where the browser supports it; desktop browsers can show a file chooser.
Cancellation and unreadable/foreign QR codes preserve the registration form.

No iOS/Android build or OTA is made for this web release. Existing iOS binaries
lack a camera usage description, so their source path safely uses the already
available photo picker. `NSCameraUsageDescription` is present in source for a
future native build. Only a native build containing that declaration should enable
`--dart-define=BULKA_IOS_QR_CAMERA_AVAILABLE=true`; the default remains disabled.

## Release size and cached deferred code

The normal optimized web build measures `main.dart.js` at 6,676,976 B raw /
1,822,142 B gzip; finalizing its deferred URL measures 6,677,016 B / 1,822,147 B.
The QR decoder loads only when scanning: 56,453 B raw / 19,842 B gzip. The entry
budgets are narrowly raised from 6,652,000 / 1,818,000 to 6,680,000 / 1,824,000.
The final web-only registration routing fits these limits without raising them again.
Separate total deferred-code budgets of 58,000 B raw / 21,000 B gzip prevent
unbounded growth hidden behind a small initial entry. Other asset limits remain.

`finalize-flutter-web.js` gives every deferred chunk a release-specific filename
with its content fingerprint and rewrites the generated references. The release
manifest records each delivered chunk's SHA-256. A new entry cannot fetch a stale
decoder from the same immutable URL. Missing referenced chunks fail finalization
before the HTML shell is rewritten; reused output directories discard only
obsolete generated chunk filenames. Release/cache and deferred-budget tests cover
these failures.
