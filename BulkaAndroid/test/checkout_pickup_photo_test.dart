import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image_picker/image_picker.dart';
import 'package:shared_preferences/shared_preferences.dart';

const _photoId = '9d479966-406a-41b4-9ad3-911ab7c6e2f2';
final _photoBytes = base64Decode(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR3sAAAAASUVORK5CYII=',
);

class _PhotoApi extends BulkaApiClient {
  String owner = 'customer-one';
  bool photoAvailable = true;
  int capabilityCalls = 0;
  int uploads = 0;
  int previewReads = 0;
  final removed = <String>[];
  Completer<Map<String, dynamic>>? pendingUpload;
  Completer<Uint8List>? pendingPreview;
  final events = StreamController<Map<String, dynamic>>.broadcast();
  final startsAt = DateTime.utc(2026, 10, 6, 6);

  @override
  String? get sessionCacheScope => owner;
  @override
  Stream<Map<String, dynamic>> get customerEvents => events.stream;
  @override
  Future<bool> isPickupOrderPhotoAvailable(String branchId) async {
    capabilityCalls++;
    return photoAvailable;
  }

  @override
  Future<Map<String, dynamic>> uploadPickupOrderPhoto({
    required List<int> bytes,
    required String mimeType,
  }) async {
    uploads++;
    expect(mimeType, 'image/png');
    expect(bytes, _photoBytes);
    return pendingUpload?.future ?? uploaded;
  }

  Map<String, dynamic> get uploaded => {
    'success': true,
    'photoId': _photoId,
    'expiresAt': DateTime.now()
        .toUtc()
        .add(const Duration(days: 1))
        .toIso8601String(),
  };
  @override
  Future<Uint8List> getPickupOrderPhotoImage(String id) async {
    previewReads++;
    expect(id, _photoId);
    return pendingPreview?.future ?? _photoBytes;
  }

  @override
  Future<void> removePickupOrderPhoto(String id) async => removed.add(id);
  @override
  Future<List<DeliveryAddress>> getCustomerAddresses() async => [];
  @override
  Future<bool> isFortePaymentAvailable() async => true;
  @override
  Future<Map<String, dynamic>> getPersonalAccount() async => {'enabled': false};
  @override
  Future<List<Map<String, dynamic>>> getFortePaymentMethods() async => [
    {'id': 'card-one', 'brand': 'visa', 'lastFour': '1328', 'isDefault': true},
  ];
  @override
  Future<List<BakeryLocation>> getFulfillmentLocations() async => const [
    BakeryLocation(
      id: 'branch-one',
      name: 'Филиал',
      address: 'Дом 1',
      city: 'Актау',
    ),
  ];
  @override
  Future<List<FulfillmentSlot>> getFulfillmentSlots({
    required String branchId,
    required String orderType,
    int days = 7,
    List<String> productIds = const [],
  }) async => [
    FulfillmentSlot(
      startsAt: startsAt,
      endsAt: startsAt.add(const Duration(hours: 1)),
      capacity: 10,
      remaining: 10,
      serverTime: startsAt.subtract(const Duration(hours: 1)),
    ),
  ];
  @override
  Future<Map<String, dynamic>> quoteForteOrder({
    required List<Map<String, dynamic>> cartItems,
    String? orderType,
    String? branch,
    String? branchId,
    String? scheduledAt,
    String? preorderFulfillmentType,
    DeliveryAddress? deliveryAddress,
    String? promoCode,
    bool useBonuses = false,
  }) async => {
    'success': true,
    'subtotal': 180,
    'discount': 0,
    'deliveryFee': 0,
    'bonusAvailable': 1000,
    'bonusMaximum': 90,
    'bonusSpent': 0,
    'total': 180,
    'deliveryQuoteToken': 'validated-delivery',
  };
}

final _capture = find.byKey(const ValueKey('checkout-capture-pickup-photo'));
final _remove = find.byKey(const ValueKey('checkout-remove-pickup-photo'));
final _submit = find.byKey(const ValueKey('checkout-submit'));

Future<void> _open(
  WidgetTester tester,
  _PhotoApi api, {
  String orderType = 'pickup',
  Future<XFile?> Function()? capture,
  ValueChanged<String?>? onSubmitted,
  Future<FortePaymentOutcome> Function()? onSubmit,
  String? initialCheckoutId,
  double height = 1500,
  Map<String, Object> initialValues = const {},
}) async {
  appLanguageNotifier.value = 'ru';
  tester.view.physicalSize = Size(430, height);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  SharedPreferences.setMockInitialValues({
    'selected_order_type': orderType,
    'selected_bakery_location': 'Филиал',
    'selected_bakery_location_id': 'branch-one',
    customerPreferenceKey('checkout_scheduled_at', api.owner): api.startsAt
        .toIso8601String(),
    ...initialValues,
  });
  await tester.pumpWidget(
    RepaintBoundary(
      key: const ValueKey('checkout-photo-render'),
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: buildBulkaTheme(),
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context).copyWith(alwaysUse24HourFormat: true),
          child: child!,
        ),
        home: buildCheckoutScreenForTest(
          api: api,
          total: 180,
          cartItems: const [
            {'productId': 'bun', 'quantity': 1},
          ],
          capturePickupPhoto:
              capture ??
              () async => XFile.fromData(
                _photoBytes,
                name: 'photo.png',
                mimeType: 'image/png',
              ),
          onPickupPhotoSubmitted: onSubmitted,
          onSubmit: onSubmit,
          initialCheckoutId: initialCheckoutId,
        ),
      ),
    ),
  );
  if (api.pendingPreview != null) {
    for (var frame = 0; frame < 12; frame++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
  } else {
    await tester.pumpAndSettle();
  }
  addTearDown(() async {
    await tester.pumpWidget(const SizedBox.shrink());
    await api.events.close();
    api.dispose();
  });
}

Map<String, Object> _draft(_PhotoApi api, {bool expired = false}) => {
  customerPreferenceKey('checkout_pickup_photo', api.owner): jsonEncode({
    'photoId': _photoId,
    'expiresAt': expired
        ? DateTime.now().subtract(const Duration(days: 1)).toIso8601String()
        : api.uploaded['expiresAt'],
    'branchId': 'branch-one',
    'cartScope': jsonEncode(const [
      {'productId': 'bun', 'quantity': 1},
    ]),
  }),
};

Future<void> _render(WidgetTester tester) async {
  final directory = Platform.environment['BULKA_CHECKOUT_RENDER_DIR'];
  if (directory == null) return;
  final boundary = tester.renderObject<RenderRepaintBoundary>(
    find.byKey(const ValueKey('checkout-photo-render')),
  );
  await tester.runAsync(() async {
    final image = await boundary.toImage(pixelRatio: 1);
    final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
    await Directory(directory).create(recursive: true);
    await File(
      '$directory/checkout-photo-430.png',
    ).writeAsBytes(bytes!.buffer.asUint8List());
    image.dispose();
  });
}

void main() {
  testWidgets(
    'optional pickup photo fits alongside the compact payment footer',
    (tester) async {
      await tester.runAsync(() async {
        for (final entry in {
          'MontserratBold': 'assets/fonts/Montserrat-Bold-subset.ttf',
          'Montserrat': 'assets/fonts/Montserrat-Regular-subset.ttf',
          'MaterialIcons': 'assets/fonts/BulkaIcons.ttf',
        }.entries) {
          await (FontLoader(
            entry.key,
          )..addFont(rootBundle.load(entry.value))).load();
        }
      });
      await _open(tester, _PhotoApi(), height: 932);
      await tester.ensureVisible(_capture);
      await tester.pumpAndSettle();
      expect(find.text('checkout_photo_title'.tr), findsOneWidget);
      expect(
        find.byKey(const ValueKey('checkout-payment-selector')),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
      await _render(tester);
    },
  );

  testWidgets(
    'photo is captured only by request and an uploaded id enters pickup checkout',
    (tester) async {
      final api = _PhotoApi();
      String? submittedPhoto;
      int captures = 0;
      await _open(
        tester,
        api,
        onSubmitted: (id) => submittedPhoto = id,
        capture: () async {
          captures++;
          return XFile.fromData(
            _photoBytes,
            name: 'photo.png',
            mimeType: 'image/png',
          );
        },
      );
      expect(captures, 0);
      expect(api.uploads, 0);
      expect(find.text('checkout_order_type'.tr), findsNothing);
      expect(find.text('checkout_catalog_locked'.tr), findsNothing);
      await tester.tap(_capture);
      await tester.pumpAndSettle();
      expect(captures, 1);
      expect(api.uploads, 1);
      expect(
        find.byKey(const ValueKey('checkout-pickup-photo-preview')),
        findsOneWidget,
      );
      await tester.tap(_submit);
      await tester.pumpAndSettle();
      expect(submittedPhoto, _photoId);
      final prefs = await SharedPreferences.getInstance();
      final draft = jsonDecode(
        prefs.getString(
          customerPreferenceKey('checkout_pickup_photo', api.owner),
        )!,
      );
      expect(draft['photoId'], _photoId);
      expect(draft.containsKey('bytes'), isFalse);
      expect(draft.containsKey('phone'), isFalse);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('removing a photo clears its draft and checkout attachment', (
    tester,
  ) async {
    final api = _PhotoApi();
    String? submittedPhoto = 'must-clear';
    await _open(tester, api, onSubmitted: (id) => submittedPhoto = id);
    await tester.tap(_capture);
    await tester.pumpAndSettle();
    await tester.tap(_remove);
    await tester.pumpAndSettle();
    expect(api.removed, [_photoId]);
    expect(
      find.byKey(const ValueKey('checkout-pickup-photo-preview')),
      findsNothing,
    );
    expect(
      (await SharedPreferences.getInstance()).getString(
        customerPreferenceKey('checkout_pickup_photo', api.owner),
      ),
      isNull,
    );
    await tester.tap(_submit);
    await tester.pumpAndSettle();
    expect(submittedPhoto, isNull);
  });

  testWidgets(
    'a pending or failed photo upload blocks checkout until retry or removal',
    (tester) async {
      final api = _PhotoApi();
      await _open(tester, api);
      final pending = api.pendingUpload = Completer<Map<String, dynamic>>();
      await tester.tap(_capture);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      expect(tester.widget<GradientButton>(_submit).onPressed, isNull);
      pending.completeError(ApiException('checkout_photo_upload_error'.tr));
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('checkout-pickup-photo-error')),
        findsOneWidget,
      );
      expect(tester.widget<GradientButton>(_submit).onPressed, isNull);
      await tester.tap(_remove);
      await tester.pumpAndSettle();
      expect(tester.widget<GradientButton>(_submit).onPressed, isNotNull);
    },
  );

  testWidgets(
    'cancelling the camera keeps checkout usable without an attachment',
    (tester) async {
      final api = _PhotoApi();
      await _open(tester, api, capture: () async => null);
      await tester.tap(_capture);
      await tester.pumpAndSettle();
      expect(api.uploads, 0);
      expect(tester.widget<GradientButton>(_submit).onPressed, isNotNull);
    },
  );

  testWidgets(
    'delivery and a point without a ready photo printer have no photo offer',
    (tester) async {
      final api = _PhotoApi();
      await _open(tester, api, orderType: 'delivery');
      expect(find.byKey(const ValueKey('checkout-pickup-photo')), findsNothing);
      expect(api.capabilityCalls, 0);
    },
  );

  testWidgets('pickup photo is hidden when the point cannot print it', (
    tester,
  ) async {
    final api = _PhotoApi()..photoAvailable = false;
    await _open(tester, api);
    expect(find.byKey(const ValueKey('checkout-pickup-photo')), findsNothing);
    expect(tester.widget<GradientButton>(_submit).onPressed, isNotNull);
  });

  testWidgets(
    'restored drafts are verified through a private image request before submission',
    (tester) async {
      final api = _PhotoApi();
      final pending = api.pendingPreview = Completer<Uint8List>();
      await _open(
        tester,
        api,
        initialValues: {
          customerPreferenceKey('checkout_pickup_photo', api.owner): jsonEncode(
            {
              'photoId': _photoId,
              'expiresAt': api.uploaded['expiresAt'],
              'branchId': 'branch-one',
              'cartScope': jsonEncode(const [
                {'productId': 'bun', 'quantity': 1},
              ]),
            },
          ),
        },
      );
      expect(api.previewReads, 1);
      expect(tester.widget<GradientButton>(_submit).onPressed, isNull);
      pending.complete(_photoBytes);
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('checkout-pickup-photo-preview')),
        findsOneWidget,
      );
      expect(tester.widget<GradientButton>(_submit).onPressed, isNotNull);
    },
  );

  testWidgets(
    'an expired draft offers removal and blocks a new checkout until resolved',
    (tester) async {
      final api = _PhotoApi()..photoAvailable = false;
      await _open(tester, api, initialValues: _draft(api, expired: true));
      expect(api.previewReads, 0);
      expect(find.text('checkout_photo_expired'.tr), findsOneWidget);
      expect(_remove, findsOneWidget);
      expect(tester.widget<GradientButton>(_submit).onPressed, isNull);
      await tester.tap(_remove);
      await tester.pumpAndSettle();
      expect(tester.widget<GradientButton>(_submit).onPressed, isNotNull);
    },
  );

  testWidgets(
    'pending payment preserves its photo id even if the private preview expired',
    (tester) async {
      final api = _PhotoApi()..photoAvailable = false;
      final pending = api.pendingPreview = Completer<Uint8List>();
      String? submitted;
      await _open(
        tester,
        api,
        initialValues: _draft(api, expired: true),
        initialCheckoutId: '93038f7e-1e94-40f0-a29b-5f9f8b63df7c',
        onSubmitted: (id) => submitted = id,
        onSubmit: () async => FortePaymentOutcome.pending,
      );
      expect(tester.widget<GradientButton>(_submit).onPressed, isNotNull);
      expect(
        tester
            .widget<InkWell>(
              find.ancestor(
                of: find.text('Филиал'),
                matching: find.byType(InkWell),
              ),
            )
            .onTap,
        isNull,
      );
      pending.completeError(
        ApiException('Expired', statusCode: 410, code: 'PICKUP_PHOTO_EXPIRED'),
      );
      await tester.pumpAndSettle();
      expect(_remove, findsNothing);
      expect(tester.widget<GradientButton>(_submit).onPressed, isNotNull);
      await tester.tap(_submit);
      await tester.pumpAndSettle();
      expect(submitted, _photoId);
    },
  );

  testWidgets('a late upload cannot restore a photo removed while uploading', (
    tester,
  ) async {
    final api = _PhotoApi();
    await _open(tester, api);
    final pending = api.pendingUpload = Completer<Map<String, dynamic>>();
    await tester.tap(_capture);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    await tester.tap(_remove);
    await tester.pump();
    pending.complete(api.uploaded);
    await tester.pumpAndSettle();
    expect(api.removed, [_photoId]);
    expect(
      find.byKey(const ValueKey('checkout-pickup-photo-preview')),
      findsNothing,
    );
    expect(
      (await SharedPreferences.getInstance()).getString(
        customerPreferenceKey('checkout_pickup_photo', api.owner),
      ),
      isNull,
    );
    expect(tester.widget<GradientButton>(_submit).onPressed, isNotNull);
  });

  testWidgets(
    'a pre-gateway photo rejection allows removal but an uncertain payment preserves it',
    (tester) async {
      final api = _PhotoApi();
      var requestChanged = false;
      await _open(
        tester,
        api,
        onSubmit: () async => throw ApiException(
          'Photo invalid',
          statusCode: 409,
          code: requestChanged
              ? 'PICKUP_PHOTO_REQUEST_CHANGED'
              : 'PICKUP_PHOTO_PRINTER_UNAVAILABLE',
        ),
      );
      await tester.tap(_capture);
      await tester.pumpAndSettle();
      await tester.tap(_submit);
      await tester.pumpAndSettle();
      expect(_remove, findsOneWidget);
      requestChanged = true;
      await tester.tap(_submit);
      await tester.pumpAndSettle();
      expect(_remove, findsNothing);
    },
  );

  testWidgets(
    'known quote and bonus rejections clear pending attempts before another photo choice',
    (tester) async {
      final api = _PhotoApi();
      final checkoutIds = <String?>[];
      final codes = [
        'CHECKOUT_QUOTE_CHANGED',
        'CHECKOUT_BONUS_CHANGED',
        'CHECKOUT_BONUS_UNAVAILABLE',
      ];
      var attempt = 0;
      await _open(
        tester,
        api,
        onSubmit: () async {
          final prefs = await SharedPreferences.getInstance();
          checkoutIds.add(
            prefs.getString(customerPreferenceKey('checkout_id', api.owner)),
          );
          throw ApiException('Revalidate', code: codes[attempt++]);
        },
      );
      await tester.tap(_capture);
      await tester.pumpAndSettle();
      for (final _ in codes) {
        await tester.tap(_submit);
        await tester.pumpAndSettle();
        expect(_remove, findsOneWidget);
        expect(
          (await SharedPreferences.getInstance()).getString(
            customerPreferenceKey('checkout_id', api.owner),
          ),
          isNull,
        );
      }
      expect(checkoutIds.toSet().length, codes.length);
    },
  );
}
