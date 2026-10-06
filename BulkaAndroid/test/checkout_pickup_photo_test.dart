import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:bulka_bonus/core/photo_orientation.dart';
import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image_picker/image_picker.dart';
import 'package:image/image.dart' as img;
import 'package:shared_preferences/shared_preferences.dart';

const _photoId = '9d479966-406a-41b4-9ad3-911ab7c6e2f2';
final _photoBytes = img.encodePng(
  img.Image(width: 2, height: 2, numChannels: 3)
    ..clear(img.ColorRgb8(255, 255, 255)),
);
final _preparedPhotoBytes = preparePickupPhoto(_photoBytes)['original']!;

class _PhotoApi extends BulkaApiClient {
  String owner = 'customer-one';
  bool photoAvailable = true;
  int capabilityCalls = 0;
  int uploads = 0;
  int previewReads = 0;
  List<int> expectedPhotoBytes = _preparedPhotoBytes;
  List<int>? uploadedPhotoBytes;
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
    expect(mimeType, 'image/jpeg');
    expect(bytes, expectedPhotoBytes);
    uploadedPhotoBytes = List<int>.of(bytes);
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
final _confirmPreview = find.byKey(
  const ValueKey('checkout-pickup-photo-confirm-preview'),
);
final _mirrorPhoto = find.byKey(const ValueKey('checkout-mirror-pickup-photo'));
final _usePhoto = find.byKey(const ValueKey('checkout-use-pickup-photo'));
final _cancelPhoto = find.byKey(const ValueKey('checkout-cancel-pickup-photo'));

Future<void> _captureUntil(WidgetTester tester, Finder ready) async {
  // Native compute runs on a real isolate, outside the widget test's fake clock.
  await tester.runAsync(() async {
    await tester.tap(_capture);
    for (var frame = 0; frame < 500; frame++) {
      await tester.pump();
      if (ready.evaluate().isNotEmpty) return;
      await Future<void>.delayed(const Duration(milliseconds: 10));
    }
  });
  await tester.pump(const Duration(milliseconds: 400));
  expect(ready, findsOneWidget);
}

Future<void> _capturePreview(WidgetTester tester) =>
    _captureUntil(tester, _confirmPreview);

Future<void> _captureAndUse(WidgetTester tester) async {
  await _capturePreview(tester);
  await _previewAction(tester, _usePhoto);
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 300));
}

Future<void> _previewAction(WidgetTester tester, Finder action) async {
  await tester.runAsync(() async {
    await tester.tap(action);
    // Continue the capture's real-isolate async chain before settling frames.
    await Future<void>.delayed(Duration.zero);
  });
}

Uint8List _previewBytes(WidgetTester tester, Finder preview) =>
    (tester.widget<Image>(preview).image as MemoryImage).bytes;

Uint8List _asymmetricPhoto() {
  final image = img.Image(width: 32, height: 20, numChannels: 3);
  for (final pixel in image) {
    pixel.setRgb(pixel.x < 12 ? 20 : 230, pixel.y < 8 ? 30 : 170, 90);
  }
  return img.encodePng(image);
}

Future<void> _open(
  WidgetTester tester,
  _PhotoApi api, {
  String orderType = 'pickup',
  Future<XFile?> Function()? capture,
  ValueChanged<String?>? onSubmitted,
  Future<FortePaymentOutcome> Function()? onSubmit,
  String? initialCheckoutId,
  double height = 1500,
  double width = 430,
  double textScale = 1,
  Map<String, Object> initialValues = const {},
}) async {
  appLanguageNotifier.value = 'ru';
  tester.view.physicalSize = Size(width, height);
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
          data: MediaQuery.of(context).copyWith(
            alwaysUse24HourFormat: true,
            textScaler: TextScaler.linear(textScale),
          ),
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
      await _capturePreview(tester);
      expect(captures, 1);
      expect(api.uploads, 0);
      expect(_previewBytes(tester, _confirmPreview), _preparedPhotoBytes);
      await _previewAction(tester, _usePhoto);
      await tester.pumpAndSettle();
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
    await _captureAndUse(tester);
    await tester.pumpAndSettle();
    await _previewAction(tester, _remove);
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
    'reflection is reversible and the selected preview is uploaded exactly once',
    (tester) async {
      final original = _asymmetricPhoto();
      final choices = preparePickupPhoto(original);
      final api = _PhotoApi()..expectedPhotoBytes = choices['mirrored']!;
      await _open(
        tester,
        api,
        capture: () async => XFile.fromData(
          original,
          name: 'gallery-or-camera.png',
          mimeType: 'image/png',
        ),
      );
      await _capturePreview(tester);
      expect(_previewBytes(tester, _confirmPreview), choices['original']);
      expect(api.uploads, 0);
      expect(tester.widget<GradientButton>(_submit).onPressed, isNull);
      await tester.tap(_mirrorPhoto);
      await tester.pump();
      expect(_previewBytes(tester, _confirmPreview), choices['mirrored']);
      await tester.tap(_mirrorPhoto);
      await tester.pump();
      expect(_previewBytes(tester, _confirmPreview), choices['original']);
      await tester.tap(_mirrorPhoto);
      await tester.pump();
      final selected = _previewBytes(tester, _confirmPreview);
      expect(api.uploads, 0);
      await _previewAction(tester, _usePhoto);
      await tester.pumpAndSettle();
      expect(api.uploads, 1);
      expect(api.uploadedPhotoBytes, selected);
      expect(
        _previewBytes(
          tester,
          find.byKey(const ValueKey('checkout-pickup-photo-preview')),
        ),
        selected,
      );
      // A replacement starts from its canonical original, independently of
      // the previous photo's choice. Cancelling does not consume another upload.
      await _capturePreview(tester);
      expect(_previewBytes(tester, _confirmPreview), choices['original']);
      await _previewAction(tester, _cancelPhoto);
      await tester.pumpAndSettle();
      expect(api.uploads, 1);
      expect(api.removed, isEmpty);
      expect(
        _previewBytes(
          tester,
          find.byKey(const ValueKey('checkout-pickup-photo-preview')),
        ),
        selected,
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('cancelling the preview uploads nothing and unblocks checkout', (
    tester,
  ) async {
    final api = _PhotoApi();
    await _open(tester, api);
    await _capturePreview(tester);
    await tester.tap(_mirrorPhoto);
    await tester.pump();
    await _previewAction(tester, _cancelPhoto);
    await tester.pumpAndSettle();
    expect(api.uploads, 0);
    expect(api.removed, isEmpty);
    expect(tester.widget<GradientButton>(_submit).onPressed, isNotNull);
    expect(
      find.byKey(const ValueKey('checkout-pickup-photo-preview')),
      findsNothing,
    );
  });

  testWidgets(
    'an unreadable photo has a clear error without using upload quota',
    (tester) async {
      final api = _PhotoApi();
      await _open(
        tester,
        api,
        capture: () async => XFile.fromData(
          Uint8List.fromList([1, 2, 3, 4]),
          name: 'corrupt.jpg',
          mimeType: 'image/jpeg',
        ),
      );
      await _captureUntil(tester, find.text('checkout_photo_prepare_error'.tr));
      await tester.pumpAndSettle();
      expect(api.uploads, 0);
      expect(_confirmPreview, findsNothing);
      expect(tester.widget<GradientButton>(_submit).onPressed, isNotNull);
    },
  );

  testWidgets('a preview cannot upload after its customer changes', (
    tester,
  ) async {
    final api = _PhotoApi();
    await _open(tester, api);
    await _capturePreview(tester);
    api.owner = 'customer-two';
    await _previewAction(tester, _usePhoto);
    await tester.pump(const Duration(milliseconds: 400));
    expect(api.uploads, 0);
    expect(api.removed, isEmpty);
  });

  testWidgets('photo confirmation fits a narrow display with enlarged text', (
    tester,
  ) async {
    final api = _PhotoApi();
    await _open(tester, api, width: 320, height: 640, textScale: 1.5);
    await tester.ensureVisible(_capture);
    await tester.pumpAndSettle();
    await _capturePreview(tester);
    expect(tester.takeException(), isNull);
    await tester.ensureVisible(_usePhoto);
    await _previewAction(tester, _usePhoto);
    await tester.pumpAndSettle();
    expect(api.uploads, 1);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'a pending or failed photo upload blocks checkout until retry or removal',
    (tester) async {
      final api = _PhotoApi();
      await _open(tester, api);
      final pending = api.pendingUpload = Completer<Map<String, dynamic>>();
      await _captureAndUse(tester);
      expect(tester.widget<GradientButton>(_submit).onPressed, isNull);
      pending.completeError(ApiException('checkout_photo_upload_error'.tr));
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('checkout-pickup-photo-error')),
        findsOneWidget,
      );
      expect(tester.widget<GradientButton>(_submit).onPressed, isNull);
      await _previewAction(tester, _remove);
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
      await _previewAction(tester, _remove);
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
    await _captureAndUse(tester);
    await _previewAction(tester, _remove);
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
      await _captureAndUse(tester);
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
      await _captureAndUse(tester);
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
