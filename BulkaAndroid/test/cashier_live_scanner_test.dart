import 'dart:async';
import 'dart:typed_data';

import 'package:bulka_bonus/core/cashier_invite.dart';
import 'package:bulka_bonus/core/cashier_live_camera.dart';
import 'package:bulka_bonus/core/cashier_qr_decoder.dart';
import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;
import 'package:shared_preferences/shared_preferences.dart';
// Exercise delayed writes through shared_preferences' own platform boundary.
// ignore: depend_on_referenced_packages
import 'package:shared_preferences_platform_interface/shared_preferences_platform_interface.dart';

import 'cashier_invite_test.dart' show inviteUrl, token, qrPhoto;

class _Camera extends CashierLiveCamera {
  _Camera({this.onStart});
  final Future<void> Function()? onStart;
  int starts = 0;
  int stops = 0;
  int frames = 0;
  bool disposed = false;
  bool active = false;
  int generation = 0;

  @override
  Future<void> start() async {
    starts++;
    final startedGeneration = generation;
    await onStart?.call();
    if (!disposed && startedGeneration == generation) active = true;
  }

  @override
  CashierCameraFrame? captureFrame() {
    if (!active) return null;
    frames++;
    return CashierCameraFrame(2, 2, Uint8List(16));
  }

  @override
  Widget buildPreview() => const ColoredBox(color: Colors.brown);

  @override
  void stop() {
    stops++;
    generation++;
    active = false;
  }

  @override
  void dispose() {
    disposed = true;
    stop();
    onInterrupted = null;
  }
}

class _DelayedPreferences extends InMemorySharedPreferencesStore {
  _DelayedPreferences() : super.empty();
  final written = Completer<void>();
  final resume = Completer<void>();
  bool delay = true;

  @override
  Future<bool> setValue(String type, String key, Object value) async {
    if (key.endsWith(PendingCashierInvite.key) && delay) {
      delay = false;
      written.complete();
      await resume.future;
    }
    return super.setValue(type, key, value);
  }
}

Future<GlobalKey<NavigatorState>> _openScanner(
  WidgetTester tester, {
  required _Camera camera,
  required List<String?> results,
  required Future<String?> Function(CashierCameraFrame) decode,
  ValueNotifier<bool>? cancelled,
  Size size = const Size(390, 844),
  double scale = 1,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  final navigator = GlobalKey<NavigatorState>();
  await tester.pumpWidget(
    MaterialApp(
      navigatorKey: navigator,
      theme: buildBulkaTheme(),
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(
          context,
        ).copyWith(textScaler: TextScaler.linear(scale)),
        child: child!,
      ),
      home: Scaffold(
        body: TextButton(
          onPressed: () async {
            results.add(
              await navigator.currentState!.push<String>(
                MaterialPageRoute(
                  builder: (_) => CashierQrScanner(
                    camera: camera,
                    decode: decode,
                    cancelled: cancelled,
                  ),
                ),
              ),
            );
          },
          child: const Text('Open scanner'),
        ),
      ),
    ),
  );
  await tester.tap(find.text('Open scanner'));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 300));
  return navigator;
}

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    PendingCashierInvite.tokenNotifier.value = null;
    appLanguageNotifier.value = 'ru';
    clientRouteNotifier.value = Uri(path: '/profile');
  });

  tearDown(() => clientRouteNotifier.value = Uri(path: '/'));

  test('Safari fallback decodes RGBA QR frames at four orientations', () {
    for (final angle in [0, 90, 180, 270]) {
      final photo = img.copyRotate(qrPhoto(inviteUrl), angle: angle);
      final rgba = photo
          .convert(numChannels: 4)
          .getBytes(order: img.ChannelOrder.rgba);
      expect(
        decodeCashierInviteFrame({
          'width': photo.width,
          'height': photo.height,
          'rgba': rgba,
        }),
        inviteUrl,
      );
    }
    for (final frame in [
      <String, Object>{'width': 0, 'height': 2, 'rgba': Uint8List(0)},
      <String, Object>{'width': 2, 'height': 2, 'rgba': Uint8List(15)},
      <String, Object>{
        'width': 721,
        'height': 721,
        'rgba': Uint8List(721 * 721 * 4),
      },
      <String, Object>{'width': 2, 'height': 2, 'rgba': Uint8List(16)},
    ]) {
      expect(decodeCashierInviteFrame(frame), isNull);
    }
  });

  testWidgets(
    'valid repeated frames return once, stop camera and never persist',
    (tester) async {
      final camera = _Camera();
      final results = <String?>[];
      await _openScanner(
        tester,
        camera: camera,
        results: results,
        decode: (_) async => inviteUrl,
      );
      await tester.pump(const Duration(milliseconds: 350));
      await tester.pumpAndSettle();
      expect(results, [inviteUrl]);
      expect(camera.disposed, isTrue);
      expect(camera.active, isFalse);
      await tester.pump(const Duration(seconds: 2));
      expect(camera.frames, 1);
      expect(results, [inviteUrl]);
      expect(await PendingCashierInvite.read(), isNull);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'foreign and duplicate-token QR stay open until a trusted invitation',
    (tester) async {
      final camera = _Camera();
      final results = <String?>[];
      final values = [
        'https://evil.example/profile?cashier=$token',
        '$inviteUrl&cashier=$token',
        inviteUrl,
      ];
      await _openScanner(
        tester,
        camera: camera,
        results: results,
        decode: (_) async => values.removeAt(0),
      );
      for (var i = 0; i < 2; i++) {
        await tester.pump(const Duration(milliseconds: 350));
        await tester.pump();
        expect(results, isEmpty);
        expect(find.text('Нужен QR сотрудника Bulka'), findsOneWidget);
      }
      await tester.pump(const Duration(milliseconds: 350));
      await tester.pumpAndSettle();
      expect(results, [inviteUrl]);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'cancel while decoding never pops a newer page or returns a late result',
    (tester) async {
      final camera = _Camera();
      final reply = Completer<String?>();
      final results = <String?>[];
      final navigator = await _openScanner(
        tester,
        camera: camera,
        results: results,
        decode: (_) => reply.future,
      );
      await tester.pump(const Duration(milliseconds: 350));
      await tester.pump(const Duration(seconds: 2));
      expect(
        camera.frames,
        1,
        reason: 'Frame decoding must remain sequential.',
      );
      await tester.tap(find.byKey(const ValueKey('cashier-scanner-close')));
      await tester.pumpAndSettle();
      expect(camera.active, isFalse);
      unawaited(
        navigator.currentState!.push(
          MaterialPageRoute<void>(
            builder: (_) => const Scaffold(body: Text('Another page')),
          ),
        ),
      );
      await tester.pumpAndSettle();
      reply.complete(inviteUrl);
      await tester.pumpAndSettle();
      expect(find.text('Another page'), findsOneWidget);
      expect(results, [null]);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('pending permission completion after close stays closed', (
    tester,
  ) async {
    final permission = Completer<void>();
    final camera = _Camera(onStart: () => permission.future);
    final results = <String?>[];
    await _openScanner(
      tester,
      camera: camera,
      results: results,
      decode: (_) async => inviteUrl,
    );
    await tester.tap(find.byKey(const ValueKey('cashier-scanner-close')));
    await tester.pumpAndSettle();
    permission.complete();
    await tester.pumpAndSettle();
    expect(camera.disposed, isTrue);
    expect(camera.active, isFalse);
    expect(camera.frames, 0);
    expect(results, [null]);
    expect(tester.takeException(), isNull);
  });

  for (final failure in CashierCameraFailure.values) {
    testWidgets(
      'camera ${failure.name} offers safe retry and closes normally',
      (tester) async {
        var attempts = 0;
        final camera = _Camera(
          onStart: () async {
            if (attempts++ == 0) throw CashierCameraException(failure);
          },
        );
        final results = <String?>[];
        await _openScanner(
          tester,
          camera: camera,
          results: results,
          decode: (_) async => null,
        );
        await tester.pump();
        expect(camera.active, isFalse);
        expect(
          find.byKey(const ValueKey('cashier-scanner-retry')),
          findsOneWidget,
        );
        await tester.tap(find.byKey(const ValueKey('cashier-scanner-retry')));
        await tester.pump();
        expect(camera.starts, 2);
        expect(camera.active, isTrue);
        await tester.tap(find.byKey(const ValueKey('cashier-scanner-close')));
        await tester.pumpAndSettle();
        expect(results, [null]);
        expect(tester.takeException(), isNull);
      },
    );
  }

  for (final pendingStart in [false, true]) {
    testWidgets(
      'a covering route pauses ${pendingStart ? 'pending permission' : 'pending decode'} and ignores late results',
      (tester) async {
        final permission = Completer<void>();
        final frameReply = Completer<String?>();
        final camera = _Camera(
          onStart: pendingStart ? () => permission.future : null,
        );
        final results = <String?>[];
        final navigator = await _openScanner(
          tester,
          camera: camera,
          results: results,
          decode: (_) => frameReply.future,
        );
        if (!pendingStart) {
          await tester.pump(const Duration(milliseconds: 350));
          expect(camera.frames, 1);
        }
        unawaited(
          navigator.currentState!.push(
            MaterialPageRoute<void>(
              builder: (_) => const Scaffold(body: Text('Covering page')),
            ),
          ),
        );
        await tester.pump();
        expect(camera.active, isFalse);
        if (pendingStart) permission.complete();
        frameReply.complete(inviteUrl);
        await tester.pumpAndSettle();
        expect(find.text('Covering page'), findsOneWidget);
        expect(results, isEmpty);
        expect(camera.active, isFalse);
        navigator.currentState!.pop();
        await tester.pumpAndSettle();
        expect(find.text('Камера остановлена'), findsOneWidget);
        expect(
          camera.starts,
          1,
          reason: 'Returning must not restart camera automatically.',
        );
        await tester.tap(find.byKey(const ValueKey('cashier-scanner-close')));
        await tester.pumpAndSettle();
        expect(results, [null]);
        expect(tester.takeException(), isNull);
      },
    );
  }

  testWidgets(
    'permission timeout remains retryable and late grant is ignored',
    (tester) async {
      final permission = Completer<void>();
      final camera = _Camera(onStart: () => permission.future);
      final results = <String?>[];
      await _openScanner(
        tester,
        camera: camera,
        results: results,
        decode: (_) async => inviteUrl,
      );
      await tester.pump(const Duration(seconds: 21));
      await tester.pump();
      expect(
        find.byKey(const ValueKey('cashier-scanner-retry')),
        findsOneWidget,
      );
      permission.complete();
      await tester.pump();
      expect(camera.active, isFalse);
      expect(camera.frames, 0);
      await tester.tap(find.byKey(const ValueKey('cashier-scanner-close')));
      await tester.pumpAndSettle();
      expect(results, [null]);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('hidden app stops decoding and resumes only by explicit retry', (
    tester,
  ) async {
    final camera = _Camera();
    final results = <String?>[];
    await _openScanner(
      tester,
      camera: camera,
      results: results,
      decode: (_) async => null,
    );
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
    await tester.pump();
    expect(camera.active, isFalse);
    expect(find.text('Камера остановлена'), findsOneWidget);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pump(const Duration(seconds: 2));
    expect(camera.starts, 1);
    expect(camera.frames, 0);
    await tester.tap(find.byKey(const ValueKey('cashier-scanner-retry')));
    await tester.pump();
    expect(camera.starts, 2);
    await tester.tap(find.byKey(const ValueKey('cashier-scanner-close')));
    await tester.pumpAndSettle();
  });

  testWidgets('client navigation and parent cancellation stop an open camera', (
    tester,
  ) async {
    for (final fromParent in [false, true]) {
      final cancelled = ValueNotifier(false);
      final camera = _Camera();
      final results = <String?>[];
      await _openScanner(
        tester,
        camera: camera,
        results: results,
        cancelled: cancelled,
        decode: (_) async => null,
      );
      if (fromParent) {
        cancelled.value = true;
      } else {
        clientRouteNotifier.value = Uri(path: '/catalog');
      }
      expect(camera.active, isFalse);
      await tester.pumpAndSettle();
      expect(results, [null]);
      expect(camera.disposed, isTrue);
      cancelled.dispose();
    }
    expect(tester.takeException(), isNull);
  });

  for (final size in [const Size(320, 568), const Size(844, 390)]) {
    testWidgets(
      'scanner error fits ${size.width} by ${size.height} at text200',
      (tester) async {
        final camera = _Camera(
          onStart: () async =>
              throw const CashierCameraException(CashierCameraFailure.denied),
        );
        final results = <String?>[];
        await _openScanner(
          tester,
          camera: camera,
          results: results,
          size: size,
          scale: 2,
          decode: (_) async => null,
        );
        await tester.pump();
        expect(tester.takeException(), isNull);
        await tester.ensureVisible(
          find.byKey(const ValueKey('cashier-scanner-retry')),
        );
        expect(
          find.byKey(const ValueKey('cashier-scanner-close')).hitTestable(),
          findsOneWidget,
        );
        await tester.tap(find.byKey(const ValueKey('cashier-scanner-close')));
        await tester.pumpAndSettle();
      },
    );
  }

  test(
    'cancel while platform persistence is pending removes the stale write',
    () async {
      final store = _DelayedPreferences();
      SharedPreferencesStorePlatform.instance = store;
      var current = true;
      final seen = <String?>[];
      void listener() => seen.add(PendingCashierInvite.tokenNotifier.value);
      PendingCashierInvite.tokenNotifier.addListener(listener);
      addTearDown(
        () => PendingCashierInvite.tokenNotifier.removeListener(listener),
      );
      final save = PendingCashierInvite.setToken(
        token,
        isCurrent: () => current,
      );
      await store.written.future;
      current = false;
      final remove = PendingCashierInvite.clear();
      store.resume.complete();
      await Future.wait([save, remove]);
      expect(await PendingCashierInvite.read(), isNull);
      expect(
        (await store.getAll()).keys.where(
          (key) => key.endsWith(PendingCashierInvite.key),
        ),
        isEmpty,
      );
      expect(seen, isEmpty);
    },
  );

  test(
    'reads during a cancelled uncommitted write cannot publish or restore it',
    () async {
      final store = _DelayedPreferences();
      SharedPreferencesStorePlatform.instance = store;
      final seen = <String?>[];
      void listener() => seen.add(PendingCashierInvite.tokenNotifier.value);
      PendingCashierInvite.tokenNotifier.addListener(listener);
      addTearDown(
        () => PendingCashierInvite.tokenNotifier.removeListener(listener),
      );
      final save = PendingCashierInvite.setToken(token);
      await store.written.future;
      final prefs = await SharedPreferences.getInstance();
      expect(
        prefs.getString(PendingCashierInvite.key),
        contains(token),
        reason:
            'The platform cache exposes the write before persistence finishes.',
      );
      final earlierRead = PendingCashierInvite.read();
      final remove = PendingCashierInvite.clear();
      final reopenedRead = PendingCashierInvite.read();
      store.resume.complete();
      await Future.wait([save, remove]);
      expect(await earlierRead, isNull);
      expect(await reopenedRead, isNull);
      expect(seen, isEmpty);
      expect(await PendingCashierInvite.read(), isNull);
      expect(
        (await store.getAll()).keys.where(
          (key) => key.endsWith(PendingCashierInvite.key),
        ),
        isEmpty,
      );
    },
  );

  test(
    'a newer invitation cannot be erased by an older cancelled platform write',
    () async {
      final store = _DelayedPreferences();
      SharedPreferencesStorePlatform.instance = store;
      final seen = <String?>[];
      void listener() => seen.add(PendingCashierInvite.tokenNotifier.value);
      PendingCashierInvite.tokenNotifier.addListener(listener);
      addTearDown(
        () => PendingCashierInvite.tokenNotifier.removeListener(listener),
      );
      final oldSave = PendingCashierInvite.setToken(token);
      await store.written.future;
      const nextToken =
          'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
      final newSave = PendingCashierInvite.setToken(nextToken);
      store.resume.complete();
      await Future.wait([oldSave, newSave]);
      expect(await PendingCashierInvite.read(), nextToken);
      expect(seen, [nextToken]);
    },
  );
}
