# Cashier desktop web mode

The Windows cashier wrapper opens `https://bulka.com.kz/?desktop=1`.
`kiosk=1` is an equivalent opt-in flag. These flags affect presentation and
input only: the server still verifies the staff session, assigned branch and
permissions. A non-cashier account cannot enter the cashier workspace.

The opted-in window restores the existing staff cookie and shows a staff login
when unauthenticated. It does not display the consumer storefront or the
desktop phone frame. Orders, kitchen, stop list and reports use the existing
cashier screens and APIs. Logout returns to staff login. No customer tokens or
role permissions are changed by desktop mode.

## Touch input

- Quantity and preparation time have an inline numeric pad with 56 px minimum
  keys, selection replacement, backspace and clear.
- The product's catalog unit is fixed for cashiers. Whole pieces use digits;
  kilograms allow a decimal separator and up to three decimal places. The
  existing stock validation, confirmation and request id remain in place.
- Search, login/password, confirmation codes and text reasons have an embedded
  RU/KK/EN keyboard with digits, ASCII symbols and case selection. Passwords
  stay masked. The input and Done/Cancel controls remain visible while keys
  scroll on short or enlarged-text displays.
- Cancel discards a keyboard draft; Done updates the field without sending a
  form. A separate existing Save/Confirm action performs the server mutation.
- Normal mobile and website screens retain the platform keyboard. Cashiers
  cannot select or convert the stock unit in any display mode.

`StaffDesktopScope` encloses the navigator so modal sheets, order detail pages
and validation dialogs inherit the same input mode. The launch preference is
captured once per app lifecycle to survive internal URL changes.

## Verification

`BulkaAndroid/test/staff_touch_input_test.dart` covers exact opt-in flags,
touch-only staff login with password symbols, keyboard draft cancellation,
selection replacement, kilogram precision and a complete confirmed stock
mutation. It also checks mobile/landscape dimensions, RU/KK at 200% text scale,
platform input outside the opted-in scope and full-window media dimensions.

The existing cashier catalog, kitchen, routing, adaptive viewport and guest
session tests cover surrounding behavior. Windows runtime compatibility and
installer packaging are verified separately by the wrapper build.
