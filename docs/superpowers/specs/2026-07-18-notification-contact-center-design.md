# Bulka Notification and Contact Center Design

**Date:** 2026-07-18  
**Status:** Approved for implementation  
**Platforms:** iOS, Android, Flutter Web

## Goal

Replace the current plain notification list with a Bulka-branded notification and contact center inspired by the supplied references. The screen combines personal notifications and public contact information, while all contact cards, buttons, translations, visibility, and ordering are managed from the existing admin panel.

## Confirmed Product Decisions

- The screen has two tabs: **Notifications** and **Contacts**.
- Contacts are public and available without signing in.
- Notifications remain customer-specific and require authentication.
- An unauthenticated visitor lands on Contacts. Selecting Notifications starts the existing sign-in flow.
- Admins can add, edit, hide, reorder, and delete contact cards.
- Every card can contain arbitrary action buttons rather than a fixed phone/Instagram pair.
- Supported action types are phone, WhatsApp, Telegram, Instagram, VK, email, website, online chat, and custom HTTPS link.
- Card titles and action labels are editable in Russian, Kazakh, and English.
- Notification taps open the related app destination when the payload identifies one.
- The feature must behave consistently on iOS, Android, and Flutter Web.
- The existing Bulka palette and typography remain the source of truth.

## Scope

This work includes the Flutter screen, contact data model and APIs, contact management in the React admin panel, safe external-link launching, notification payload handling, branded empty-state art, localization, migrations, and tests.

It does not replace the existing push-delivery system, notification preference screen, broadcast composer, authentication flow, order screens, or promotion screens. Those systems are reused and connected to the new screen.

## Data Model

### `contact_cards`

Each row represents one independently managed visual card.

| Column | Type | Rules |
| --- | --- | --- |
| `id` | UUID | Primary key, generated server-side |
| `display_mode` | text | `standard` or `compact` |
| `title_ru` | varchar(120) | Required, trimmed |
| `title_kk` | varchar(120) | Required, trimmed |
| `title_en` | varchar(120) | Required, trimmed |
| `icon_key` | varchar(40) | Server allowlist; defaults to `bulka` |
| `sort_order` | integer | Non-negative display order |
| `is_active` | boolean | Hidden rows stay editable in admin |
| `created_at` | timestamptz | Server-generated |
| `updated_at` | timestamptz | Updated by trigger |

`standard` cards render full-width with a heading and one or more action chips. `compact` cards render in the “Additional” responsive grid and must have exactly one active action before they can be published.

### `contact_actions`

Each row represents one tappable action inside a card.

| Column | Type | Rules |
| --- | --- | --- |
| `id` | UUID | Primary key, generated server-side |
| `card_id` | UUID | Required FK with cascade delete |
| `action_type` | text | Allowed type from the confirmed list |
| `label_ru` | varchar(80) | Required, trimmed |
| `label_kk` | varchar(80) | Required, trimmed |
| `label_en` | varchar(80) | Required, trimmed |
| `target` | varchar(500) | Validated according to action type |
| `icon_key` | varchar(40) | Server allowlist; defaults from action type |
| `sort_order` | integer | Non-negative order inside the card |
| `is_active` | boolean | Hidden actions stay editable in admin |
| `created_at` | timestamptz | Server-generated |
| `updated_at` | timestamptz | Updated by trigger |

Both tables have service-role-only RLS policies. The migration is additive, creates indexes for active/order queries, and is mirrored in `supabase_schema.sql` so fresh and upgraded installations match.

No fake phone numbers or social URLs are seeded. The admin panel shows a clear first-run empty state and lets an administrator publish the first real card.

## Backend Boundaries and APIs

A focused contact-center service owns normalization, validation, persistence, projection, and reordering. Route handlers remain thin.

### Public API

`GET /api/public/contact-center`

- Requires no customer session.
- Returns active cards and active actions only.
- Returns all three translations so a cached response can switch languages offline.
- Orders cards and actions by `sort_order`, then `created_at` for deterministic ties.
- Sets a short public cache policy with stale-while-revalidate.
- Never exposes audit data or inactive records.

The response shape is:

```json
{
  "success": true,
  "updatedAt": "2026-07-18T00:00:00.000Z",
  "cards": [
    {
      "id": "uuid",
      "displayMode": "standard",
      "titles": { "ru": "Bulka", "kk": "Bulka", "en": "Bulka" },
      "iconKey": "bulka",
      "actions": [
        {
          "id": "uuid",
          "type": "phone",
          "labels": { "ru": "Позвонить", "kk": "Қоңырау шалу", "en": "Call" },
          "target": "+77000000000",
          "iconKey": "phone"
        }
      ]
    }
  ]
}
```

### Admin API

All endpoints reuse the existing admin authentication, CSRF protection, role checks, and audit middleware.

- `GET /admin/api/contact-cards`
- `POST /admin/api/contact-cards`
- `PUT /admin/api/contact-cards/:id`
- `DELETE /admin/api/contact-cards/:id`
- `PUT /admin/api/contact-cards/reorder`
- `POST /admin/api/contact-cards/:cardId/actions`
- `PUT /admin/api/contact-actions/:id`
- `DELETE /admin/api/contact-actions/:id`
- `PUT /admin/api/contact-cards/:cardId/actions/reorder`

Reorder endpoints receive the complete ordered ID list for their scope and update all positions atomically. Deleting a card deletes its actions through the database FK.

### Validation and Safety

- All RU/KK/EN labels are required before publishing.
- Phone targets are normalized to a leading `+` and 10–15 digits.
- Email targets must be syntactically valid.
- Web and channel links must use HTTPS. `javascript:`, `data:`, embedded credentials, control characters, and unsupported schemes are rejected.
- Target and label lengths are bounded at both API and database layers.
- Unknown action or icon keys are rejected rather than rendered ambiguously.
- A compact card cannot be active unless it has exactly one active action.
- Missing migrations produce a controlled service-unavailable response in admin and an empty public result rather than crashing the application.

## Notification API Extension

The existing customer notification endpoint additionally selects and returns `payload`. `AppNotification` stores a defensive string-keyed map and ignores malformed payloads.

Tap resolution follows this order:

1. Mark the notification as read locally and on the server.
2. `order`, `delivery`, or `refund` payloads with an `orderId` close the center and open the Orders tab.
3. Promotion payloads close the center and open the Promotions tab.
4. Support payloads open the existing support screen.
5. A validated HTTPS payload URL opens externally.
6. Notifications without a recognized destination remain on screen after being marked read.

Navigation is expressed through callbacks passed from `MainShell` to `HomeScreen` and then to the notification center. The screen does not reach into shell state or duplicate order/promotion implementations.

## Flutter Experience

### Entry and Authentication

The home bell always opens the new center. Authenticated customers start on Notifications; guests start on Contacts. If a guest selects Notifications, the existing authentication callback runs. On success, the tab switches and notifications load; on cancellation, Contacts remains selected.

### Header and Tabs

- Safe-area-aware header with a circular back button, centered title, and Bulka cream/gold tonal background.
- Rounded segmented control matching the supplied layout.
- Selected segment uses `#FFB814` with brown text; the unselected segment uses a white/cream surface.
- Motion uses the existing `BulkaMotion` durations and respects reduced-motion settings.
- The notification tab retains the settings action and “Mark all read” action without crowding the centered title.

### Notification List

- Warm cream cards, 24 px radius, fine gold-tan border, and restrained existing Bulka shadow.
- A leading gold notification glyph varies by notification type.
- Title uses Bulka brown and strong weight; body and localized timestamp use the existing muted-text token.
- Unread state uses a stronger gold tint plus a semantic unread indicator, so color is not the only signal.
- Tapping unread content gives immediate pressed feedback and performs the payload resolution above.
- Pull-to-refresh remains available.

### Empty, Loading, and Error States

- Empty copy is the corrected “У вас нет новых уведомлений” and its KK/EN equivalents.
- A generated transparent Bulka envelope illustration sits below the copy. It uses the app’s gold/cream/brown palette and the Bulka `B`/bread mark as a wax-style seal; no competing purple branding remains.
- Loading uses a centered branded progress indicator or card skeletons.
- Notification failure shows localized error text and a Retry button.
- Contact failure first displays cached data. If no cache exists, it shows a localized retry state rather than an empty white screen.

### Contact Cards

- Standard cards are full-width white/cream surfaces with a Bulka seal, localized title, and wrapping action chips.
- Compact cards form an “Additional” grid like the reference. The grid adapts from two columns on narrow phones to three on normal phones and more on tablets/web.
- Action chips and compact tiles use one consistent visual system: brown/gold glyph, soft gold surface, clear label, 48 dp minimum touch target.
- Phone launches `tel:`, email launches `mailto:`, and all remaining actions launch validated HTTPS URLs through `url_launcher`.
- Launch failures show a localized Snackbar and do not dismiss the screen.

### Responsive and Accessible Behavior

- All content is inside `SafeArea` and scrolls without being hidden by browser or system chrome.
- The content width is capped on tablet/web while the background spans the viewport.
- Text scaling is supported without fixed-height cards.
- Every tab, action, icon-only button, unread item, and illustration has an accessibility label/state.
- Touch targets are at least 44 pt on iOS and 48 dp on Material platforms.
- Focus order follows visual order, including Flutter Web keyboard navigation.

## Branded Assets

The supplied `bulka_logo.png` and `app_icon_foreground.png` are the visual references. Image generation produces the transparent envelope empty-state art and a Bulka seal treatment. UI action symbols stay as crisp vector glyphs from one consistent family, placed in the generated Bulka-style gold/brown containers; recognizable channel meaning is preserved without copying the purple reference branding.

Generated assets are stored under `BulkaAndroid/assets/contact_center/`, optimized for mobile size, declared in `pubspec.yaml`, and visually checked on light backgrounds at phone and tablet scale.

## Admin Experience

A dedicated **Contacts** page is added to the System section of the existing sidebar rather than overloading the current account Settings page.

The page contains:

- a list of standard and compact cards with active/inactive state;
- add, edit, duplicate, hide/show, reorder, and delete actions;
- nested action rows with type, icon, RU/KK/EN labels, and target;
- accessible up/down ordering controls without adding a drag-and-drop dependency;
- inline validation with the backend error message preserved;
- a confirmation dialog before destructive deletion;
- a responsive live preview of the selected card;
- explicit save/loading/success/error states.

Cards are saved only after client validation passes. The server remains authoritative and returns normalized values.

## Caching and Consistency

Flutter stores the last valid public contact response in `SharedPreferences` with a schema version. It renders cache immediately, refreshes in the background, and replaces cache only after a fully valid response. Admin mutations invalidate the backend contact projection cache. Notification data is never placed in the public contact cache.

## Testing and Verification

### Backend

- Service tests cover three-language validation, target normalization, unsafe schemes, compact-card publication rules, cascading deletion, stable ordering, and missing-table fallback.
- Route tests cover public projection and protected admin CRUD/reorder behavior.
- Existing notification route tests are extended to assert defensive `payload` delivery.

### Flutter

- Model tests cover translated labels, unknown action types, malformed payloads, and cache serialization.
- Widget tests cover guest/authenticated initial tabs, sign-in gating, tab semantics, notification empty/error/list states, contact card layouts, responsive grid behavior, and mark-all-read.
- Navigation tests cover order, promotion, support, safe URL, and no-destination notifications.
- Launcher behavior is injected behind a small interface so tests do not open real external apps.

### Admin

- API client and page behavior are covered by the repository’s existing admin E2E style: load, create, edit, validate, reorder, hide, and delete.
- The production React build must complete without TypeScript errors.

### Final Commands

```powershell
npm test
npm run build
Set-Location BulkaAndroid
flutter analyze
flutter test
```

Visual verification covers 320 px and 390 px phone widths, a tablet width, Flutter Web, large text, and reduced motion. Existing unrelated worktree changes are preserved and excluded from feature commits.

## Success Criteria

- The screen visibly follows the supplied notification/contact layout while looking unmistakably like Bulka.
- Guests can reach every published contact action without signing in.
- Customers can read, mark, refresh, and follow supported notification destinations.
- An administrator can fully manage cards and arbitrary buttons without code or redeployment.
- RU/KK/EN switch correctly, including cached contacts.
- No unsafe external scheme can be stored or launched.
- All three target platforms pass automated and visual checks.
