import 'dart:async';
import 'dart:convert';

import 'package:bulka_bonus/widgets/pickup_camera_native.dart';
import 'package:bulka_bonus/widgets/pickup_camera_types.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;
import 'package:image_picker/image_picker.dart';
// Exercise the existing WebView dependency through its platform boundary.
// ignore: depend_on_referenced_packages
import 'package:webview_flutter_platform_interface/webview_flutter_platform_interface.dart';

const _labels = PickupCameraLabels(
  title: 'Take pickup photo',
  capture: 'Take photo',
  switchCamera: 'Switch camera',
  close: 'Close camera',
  retry: 'Try camera again',
  error: 'Camera unavailable',
);
const _openKey = ValueKey('open-camera-test-route');
const _shutterKey = ValueKey('pickup-camera-shutter');
const _switchKey = ValueKey('pickup-camera-switch');
const _closeKey = ValueKey('pickup-camera-close');
const _retryKey = ValueKey('pickup-camera-retry');

Uint8List _jpegFixture() {
  // Asymmetric bytes make an unexpected image rewrite visible. This fixture
  // verifies route transport, not physical-camera preview behavior.
  final image = img.Image(width: 4, height: 2);
  for (var y = 0; y < image.height; y++) {
    for (var x = 0; x < image.width; x++) {
      image.setPixelRgb(x, y, x < 2 ? 240 : 10, y == 0 ? 20 : 210, x * 50);
    }
  }
  return Uint8List.fromList(img.encodeJpg(image, quality: 100));
}

final _jpeg = _jpegFixture();

class _WebViewPlatform extends WebViewPlatform {
  final List<_WebViewController> controllers = [];

  _WebViewController get controller => controllers.last;

  @override
  PlatformWebViewController createPlatformWebViewController(
    PlatformWebViewControllerCreationParams params,
  ) {
    final controller = _WebViewController(params);
    controllers.add(controller);
    return controller;
  }

  @override
  PlatformNavigationDelegate createPlatformNavigationDelegate(
    PlatformNavigationDelegateCreationParams params,
  ) => _NavigationDelegate(params);

  @override
  PlatformWebViewWidget createPlatformWebViewWidget(
    PlatformWebViewWidgetCreationParams params,
  ) => _WebViewWidget(params);
}

class _WebViewController extends PlatformWebViewController {
  _WebViewController(super.params) : super.implementation();

  final List<LoadRequestParams> requests = [];
  final List<String> scripts = [];
  final Map<String, JavaScriptChannelParams> channels = {};
  _NavigationDelegate? navigation;
  void Function(PlatformWebViewPermissionRequest)? onPermission;
  String? url;
  Completer<String?>? currentUrlGate;
  JavaScriptMode? javaScriptMode;
  Color? backgroundColor;
  bool emitCancelOnStop = false;

  Uri get loadedUri => requests.last.uri;
  String get nonce => loadedUri.fragment.substring('nonce='.length);

  int commands(String name) => scripts
      .where((script) => script == 'window.BulkaPickupCameraControls?.$name();')
      .length;

  String message(String type, [Map<String, Object?> fields = const {}]) =>
      jsonEncode(<String, Object?>{
        'v': 1,
        'nonce': nonce,
        'type': type,
        ...fields,
      });

  void emit(String type, [Map<String, Object?> fields = const {}]) {
    channels['BulkaPickupCamera']!.onMessageReceived(
      JavaScriptMessage(message: message(type, fields)),
    );
  }

  void ready([String facingMode = 'user']) =>
      emit('ready', {'facingMode': facingMode, 'width': 4, 'height': 2});

  void photo([String facingMode = 'user']) => emit('photo', {
    'facingMode': facingMode,
    'width': 4,
    'height': 2,
    'mimeType': 'image/jpeg',
    'base64': base64Encode(_jpeg),
  });

  void finishPage() => navigation!.onPageFinished!(loadedUri.toString());

  @override
  Future<void> setJavaScriptMode(JavaScriptMode value) async {
    javaScriptMode = value;
  }

  @override
  Future<void> setBackgroundColor(Color value) async {
    backgroundColor = value;
  }

  @override
  Future<void> setOnPlatformPermissionRequest(
    void Function(PlatformWebViewPermissionRequest) callback,
  ) async {
    onPermission = callback;
  }

  @override
  Future<void> addJavaScriptChannel(JavaScriptChannelParams params) async {
    channels[params.name] = params;
  }

  @override
  Future<void> setPlatformNavigationDelegate(
    PlatformNavigationDelegate handler,
  ) async {
    navigation = handler as _NavigationDelegate;
  }

  @override
  Future<void> loadRequest(LoadRequestParams params) async {
    requests.add(params);
    url = params.uri.toString();
  }

  @override
  Future<String?> currentUrl() async => currentUrlGate?.future ?? url;

  @override
  Future<void> runJavaScript(String javaScript) async {
    scripts.add(javaScript);
    if (emitCancelOnStop &&
        javaScript == 'window.BulkaPickupCameraControls?.stop();') {
      emit('cancel');
    }
  }
}

class _NavigationDelegate extends PlatformNavigationDelegate {
  _NavigationDelegate(super.params) : super.implementation();

  NavigationRequestCallback? onNavigationRequest;
  PageEventCallback? onPageStarted;
  PageEventCallback? onPageFinished;
  UrlChangeCallback? onUrlChange;
  WebResourceErrorCallback? onWebResourceError;
  HttpResponseErrorCallback? onHttpError;

  @override
  Future<void> setOnNavigationRequest(
    NavigationRequestCallback callback,
  ) async {
    onNavigationRequest = callback;
  }

  @override
  Future<void> setOnPageStarted(PageEventCallback callback) async {
    onPageStarted = callback;
  }

  @override
  Future<void> setOnPageFinished(PageEventCallback callback) async {
    onPageFinished = callback;
  }

  @override
  Future<void> setOnUrlChange(UrlChangeCallback callback) async {
    onUrlChange = callback;
  }

  @override
  Future<void> setOnWebResourceError(WebResourceErrorCallback callback) async {
    onWebResourceError = callback;
  }

  @override
  Future<void> setOnHttpError(HttpResponseErrorCallback callback) async {
    onHttpError = callback;
  }
}

class _WebViewWidget extends PlatformWebViewWidget {
  _WebViewWidget(super.params) : super.implementation();

  @override
  Widget build(BuildContext context) => const ColoredBox(
    key: ValueKey('fake-camera-preview'),
    color: Colors.black,
  );
}

class _PermissionRequest extends PlatformWebViewPermissionRequest {
  _PermissionRequest(
    Set<WebViewPermissionResourceType> types, {
    this.throwOnGrant = false,
    this.throwOnDeny = false,
  }) : super(types: types);

  final List<String> decisions = [];
  final bool throwOnGrant;
  final bool throwOnDeny;

  @override
  Future<void> grant() async {
    decisions.add('grant');
    if (throwOnGrant) throw StateError('native permission view closed');
  }

  @override
  Future<void> deny() async {
    decisions.add('deny');
    if (throwOnDeny) throw StateError('native permission view closed');
  }
}

Future<void> _flush(WidgetTester tester) async {
  await tester.pump();
  await tester.pump();
}

bool _shutterEnabled(WidgetTester tester) =>
    tester.widget<FilledButton>(find.byKey(_shutterKey)).onPressed != null;

bool _switchEnabled(WidgetTester tester) =>
    tester.widget<TextButton>(find.byKey(_switchKey)).onPressed != null;

Future<void> _open(
  WidgetTester tester,
  List<XFile?> results, {
  PickupCameraLabels labels = _labels,
  Duration openingTimeout = const Duration(seconds: 60),
  Duration captureTimeout = const Duration(seconds: 15),
}) async {
  tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
  await tester.pumpWidget(
    MaterialApp(
      home: Builder(
        builder: (context) => Scaffold(
          body: TextButton(
            key: _openKey,
            onPressed: () async {
              final result = await Navigator.of(context).push<XFile>(
                MaterialPageRoute<XFile>(
                  builder: (_) => PickupCameraScreen(
                    labels: labels,
                    openingTimeout: openingTimeout,
                    captureTimeout: captureTimeout,
                  ),
                ),
              );
              results.add(result);
            },
            child: const Text('Open test camera'),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.byKey(_openKey));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 350));
  await _flush(tester);
}

Future<void> _finishClosing(WidgetTester tester) async {
  await _flush(tester);
  await tester.pump(const Duration(milliseconds: 350));
  await tester.pump(const Duration(milliseconds: 350));
  await _flush(tester);
}

void main() {
  late _WebViewPlatform platform;
  WebViewPlatform? originalPlatform;

  setUp(() {
    originalPlatform = WebViewPlatform.instance;
    platform = _WebViewPlatform();
    WebViewPlatform.instance = platform;
  });

  tearDown(() {
    if (originalPlatform != null) WebViewPlatform.instance = originalPlatform;
  });

  test('native pickup camera is selected for iOS only', () {
    final original = debugDefaultTargetPlatformOverride;
    addTearDown(() => debugDefaultTargetPlatformOverride = original);
    for (final target in [
      TargetPlatform.iOS,
      TargetPlatform.android,
      TargetPlatform.windows,
    ]) {
      debugDefaultTargetPlatformOverride = target;
      expect(usesPickupCamera, target == TargetPlatform.iOS);
    }
  });

  testWidgets(
    'shutter waits for the loaded session nonce and verified readiness',
    (tester) async {
      final results = <XFile?>[];
      await _open(tester, results);
      final controller = platform.controller;
      expect(controller.loadedUri.scheme, 'https');
      expect(controller.loadedUri.host, 'bulka.com.kz');
      expect(controller.loadedUri.path, '/pickup/camera-v1');
      expect(controller.loadedUri.hasQuery, isFalse);
      expect(controller.nonce, matches(RegExp(r'^[0-9a-f]{32}$')));
      expect(controller.channels.keys, ['BulkaPickupCamera']);
      expect(controller.javaScriptMode, JavaScriptMode.unrestricted);
      expect(controller.backgroundColor, Colors.black);
      expect(_shutterEnabled(tester), isFalse);
      expect(_switchEnabled(tester), isFalse);

      controller.emit('ready', {
        'nonce': '00000000000000000000000000000000',
        'facingMode': 'user',
        'width': 4,
        'height': 2,
      });
      await _flush(tester);
      expect(_shutterEnabled(tester), isFalse);
      controller.ready();
      await _flush(tester);
      expect(_shutterEnabled(tester), isTrue);
      expect(_switchEnabled(tester), isTrue);
      expect(results, isEmpty);
      await tester.tap(find.byKey(_closeKey));
      await _finishClosing(tester);
    },
  );

  testWidgets(
    'one shutter command returns exact JPEG bytes without confirmation',
    (tester) async {
      final results = <XFile?>[];
      await _open(tester, results);
      final controller = platform.controller;
      controller.ready();
      await _flush(tester);

      // Exercise the guard even before the disabled button has rebuilt.
      await tester.tap(find.byKey(_shutterKey));
      await tester.tap(find.byKey(_shutterKey));
      await _flush(tester);
      expect(controller.commands('capture'), 1);
      expect(_shutterEnabled(tester), isFalse);
      expect(_switchEnabled(tester), isFalse);
      controller.photo();
      await _finishClosing(tester);

      expect(results, hasLength(1));
      expect(results.single, isNotNull);
      expect(results.single!.mimeType, 'image/jpeg');
      expect(await results.single!.readAsBytes(), orderedEquals(_jpeg));
      expect(find.byType(PickupCameraScreen), findsNothing);
      expect(controller.commands('stop'), greaterThanOrEqualTo(1));
      controller.photo();
      await _flush(tester);
      expect(results, hasLength(1));
    },
  );

  testWidgets('switch waits for fresh verified rear readiness before capture', (
    tester,
  ) async {
    final results = <XFile?>[];
    await _open(tester, results);
    final controller = platform.controller;
    controller.ready();
    await _flush(tester);
    await tester.tap(find.byKey(_switchKey));
    await tester.tap(find.byKey(_switchKey));
    await _flush(tester);
    expect(controller.commands('switchCamera'), 1);
    expect(_shutterEnabled(tester), isFalse);
    expect(_switchEnabled(tester), isFalse);
    controller.photo('environment');
    await _flush(tester);
    expect(results, isEmpty);
    expect(_shutterEnabled(tester), isFalse);

    controller.ready('environment');
    await _flush(tester);
    expect(_shutterEnabled(tester), isTrue);
    await tester.tap(find.byKey(_shutterKey));
    await _flush(tester);
    controller.photo('environment');
    await _finishClosing(tester);
    expect(results, hasLength(1));
    expect(await results.single!.readAsBytes(), orderedEquals(_jpeg));
  });

  testWidgets(
    'wrong nonce and a currently untrusted URL cannot deliver a photo',
    (tester) async {
      final results = <XFile?>[];
      await _open(tester, results);
      final controller = platform.controller;
      final trustedUrl = controller.url;
      controller.url = 'https://evil.example/pickup/camera-v1';
      controller.ready();
      await _flush(tester);
      expect(_shutterEnabled(tester), isFalse);
      expect(find.text(_labels.error), findsNothing);

      controller.url = trustedUrl;
      controller.ready();
      await _flush(tester);
      await tester.tap(find.byKey(_shutterKey));
      await _flush(tester);
      controller.emit('photo', {
        'nonce': 'wrong-session',
        'facingMode': 'user',
        'width': 4,
        'height': 2,
        'mimeType': 'image/jpeg',
        'base64': base64Encode(_jpeg),
      });
      await _flush(tester);
      expect(results, isEmpty);
      controller.url = 'http://bulka.com.kz/pickup/camera-v1';
      controller.photo();
      await _flush(tester);
      expect(results, isEmpty);
      controller.url = trustedUrl;
      controller.photo();
      await _finishClosing(tester);
      expect(results, hasLength(1));
      expect(await results.single!.readAsBytes(), orderedEquals(_jpeg));
    },
  );

  testWidgets('navigation accepts only the exact trusted main-frame page', (
    tester,
  ) async {
    final results = <XFile?>[];
    await _open(tester, results);
    final controller = platform.controller;
    final navigate = controller.navigation!.onNavigationRequest!;
    expect(
      await navigate(
        NavigationRequest(url: controller.url!, isMainFrame: true),
      ),
      NavigationDecision.navigate,
    );
    for (final request in [
      NavigationRequest(url: controller.url!, isMainFrame: false),
      const NavigationRequest(url: 'https://evil.example', isMainFrame: true),
      NavigationRequest(
        url: '${controller.loadedUri.replace(fragment: '')}?extra=1',
        isMainFrame: true,
      ),
    ]) {
      expect(await navigate(request), NavigationDecision.prevent);
    }
    await tester.tap(find.byKey(_closeKey));
    await _finishClosing(tester);
  });

  testWidgets(
    'permission grants camera only and denies microphone or other URLs',
    (tester) async {
      final results = <XFile?>[];
      await _open(tester, results);
      final controller = platform.controller;
      final camera = _PermissionRequest({WebViewPermissionResourceType.camera});
      controller.onPermission!(camera);
      await _flush(tester);
      expect(camera.decisions, ['grant']);
      for (final types in <Set<WebViewPermissionResourceType>>[
        {WebViewPermissionResourceType.microphone},
        {
          WebViewPermissionResourceType.camera,
          WebViewPermissionResourceType.microphone,
        },
        {},
      ]) {
        final request = _PermissionRequest(types);
        controller.onPermission!(request);
        await _flush(tester);
        expect(request.decisions, ['deny']);
      }
      controller.url = 'https://evil.example';
      final untrusted = _PermissionRequest({
        WebViewPermissionResourceType.camera,
      });
      controller.onPermission!(untrusted);
      await _flush(tester);
      expect(untrusted.decisions, ['deny']);
      await tester.tap(find.byKey(_closeKey));
      await _finishClosing(tester);
    },
  );

  testWidgets(
    'inactive permission prompts retain the route and pending grant',
    (tester) async {
      final results = <XFile?>[];
      await _open(tester, results);
      final controller = platform.controller;
      final gate = Completer<String?>();
      controller.currentUrlGate = gate;
      final request = _PermissionRequest({
        WebViewPermissionResourceType.camera,
      });
      controller.onPermission!(request);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      await _flush(tester);
      expect(find.byType(PickupCameraScreen), findsOneWidget);
      expect(results, isEmpty);
      expect(request.decisions, isEmpty);
      expect(controller.commands('stop'), 0);
      gate.complete(controller.loadedUri.toString());
      await _flush(tester);
      expect(request.decisions, ['grant']);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.tap(find.byKey(_closeKey));
      await _finishClosing(tester);
      expect(results, [null]);
    },
  );

  testWidgets('close cancels a queued photo and denies late permissions', (
    tester,
  ) async {
    final results = <XFile?>[];
    await _open(tester, results);
    final controller = platform.controller;
    controller.ready();
    await _flush(tester);
    await tester.tap(find.byKey(_shutterKey));
    await _flush(tester);
    final gate = Completer<String?>();
    controller.currentUrlGate = gate;
    controller.photo();
    await _flush(tester);
    await tester.tap(find.byKey(_closeKey));
    gate.complete(controller.loadedUri.toString());
    await _finishClosing(tester);
    expect(results, [null]);
    expect(controller.commands('stop'), greaterThanOrEqualTo(1));
    controller.photo();
    final permission = _PermissionRequest({
      WebViewPermissionResourceType.camera,
    });
    controller.onPermission!(permission);
    await _flush(tester);
    expect(permission.decisions, ['deny']);
    expect(results, [null]);
  });

  testWidgets(
    'native permission failures are contained during grant and disposal',
    (tester) async {
      final results = <XFile?>[];
      await _open(tester, results);
      final controller = platform.controller;
      final grantFailure = _PermissionRequest({
        WebViewPermissionResourceType.camera,
      }, throwOnGrant: true);
      controller.onPermission!(grantFailure);
      await _flush(tester);
      expect(grantFailure.decisions, ['grant', 'deny']);
      expect(results, isEmpty);
      expect(tester.takeException(), isNull);

      await tester.tap(find.byKey(_closeKey));
      await _finishClosing(tester);
      final closedRequest = _PermissionRequest({
        WebViewPermissionResourceType.camera,
      }, throwOnDeny: true);
      controller.onPermission!(closedRequest);
      await _flush(tester);
      expect(closedRequest.decisions, isNotEmpty);
      expect(closedRequest.decisions, everyElement('deny'));
      expect(results, [null]);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'back denies pending permission and ignores photo before route disposal',
    (tester) async {
      final results = <XFile?>[];
      await _open(tester, results);
      final controller = platform.controller;
      controller.ready();
      await _flush(tester);
      await tester.tap(find.byKey(_shutterKey));
      await _flush(tester);
      final gate = Completer<String?>();
      controller.currentUrlGate = gate;
      final permission = _PermissionRequest({
        WebViewPermissionResourceType.camera,
      });
      controller.onPermission!(permission);
      controller.photo();
      await _flush(tester);
      expect(permission.decisions, isEmpty);
      Navigator.of(tester.element(find.byType(PickupCameraScreen))).pop();
      await tester.pump();
      // The route remains mounted during its reverse animation. Session
      // deactivation must precede disposal and these delayed URL checks.
      expect(find.byType(PickupCameraScreen), findsOneWidget);
      gate.complete(controller.loadedUri.toString());
      controller.photo();
      await _flush(tester);
      expect(permission.decisions, ['deny']);
      expect(results, [null]);
      expect(controller.commands('stop'), greaterThanOrEqualTo(1));
      await _finishClosing(tester);
      expect(results, [null]);
      expect(controller.commands('stop'), greaterThanOrEqualTo(1));
      expect(tester.takeException(), isNull);
    },
  );

  for (final state in [AppLifecycleState.paused, AppLifecycleState.hidden]) {
    testWidgets(
      '$state cancels capture, stops the camera, and ignores late photo',
      (tester) async {
        final results = <XFile?>[];
        await _open(tester, results);
        final controller = platform.controller;
        controller.ready();
        await _flush(tester);
        await tester.tap(find.byKey(_shutterKey));
        await _flush(tester);
        tester.binding.handleAppLifecycleStateChanged(state);
        controller.photo();
        await _finishClosing(tester);
        expect(results, [null]);
        expect(controller.commands('stop'), greaterThanOrEqualTo(1));
        tester.binding.handleAppLifecycleStateChanged(
          AppLifecycleState.resumed,
        );
        await _finishClosing(tester);
        expect(find.byType(PickupCameraScreen), findsNothing);
      },
    );
  }

  testWidgets(
    'opening timeout offers retry with a fresh controller and nonce',
    (tester) async {
      final results = <XFile?>[];
      await _open(tester, results, openingTimeout: const Duration(seconds: 1));
      final controller = platform.controller;
      final originalUri = controller.loadedUri;
      await tester.pump(const Duration(seconds: 1));
      await _flush(tester);
      expect(find.text(_labels.error), findsOneWidget);
      expect(find.byKey(_retryKey), findsOneWidget);
      expect(_shutterEnabled(tester), isFalse);
      expect(controller.commands('stop'), 1);
      await tester.tap(find.byKey(_retryKey));
      await _flush(tester);
      final retryController = platform.controller;
      expect(platform.controllers, hasLength(2));
      expect(retryController, isNot(same(controller)));
      expect(controller.requests, hasLength(1));
      expect(retryController.requests, hasLength(1));
      expect(retryController.loadedUri.fragment, isNot(originalUri.fragment));
      expect(find.text(_labels.error), findsNothing);
      retryController.finishPage();
      retryController.ready();
      await _flush(tester);
      expect(_shutterEnabled(tester), isTrue);
      await tester.tap(find.byKey(_closeKey));
      await _finishClosing(tester);
    },
  );

  testWidgets('capture timeout stops and retries with a fresh front session', (
    tester,
  ) async {
    final results = <XFile?>[];
    await _open(
      tester,
      results,
      captureTimeout: const Duration(milliseconds: 200),
    );
    final controller = platform.controller;
    controller.finishPage();
    controller.ready();
    await _flush(tester);
    await tester.tap(find.byKey(_shutterKey));
    await _flush(tester);
    await tester.pump(const Duration(milliseconds: 250));
    await _flush(tester);
    expect(find.text(_labels.error), findsOneWidget);
    expect(_shutterEnabled(tester), isFalse);
    expect(controller.commands('stop'), 1);
    controller.photo();
    await _flush(tester);
    expect(results, isEmpty);
    await tester.tap(find.byKey(_retryKey));
    await _flush(tester);
    final retryController = platform.controller;
    expect(platform.controllers, hasLength(2));
    expect(retryController.nonce, isNot(controller.nonce));
    expect(retryController.requests, hasLength(1));
    expect(controller.requests, hasLength(1));
    expect(_shutterEnabled(tester), isFalse);
    retryController.ready();
    await _flush(tester);
    await tester.tap(find.byKey(_shutterKey));
    await _flush(tester);
    expect(controller.commands('capture'), 1);
    expect(retryController.commands('capture'), 1);
    retryController.photo();
    await _finishClosing(tester);
    expect(results, hasLength(1));
    expect(await results.single!.readAsBytes(), orderedEquals(_jpeg));
  });

  testWidgets(
    'rear capture failure ignores stop cancel and old session callbacks',
    (tester) async {
      final results = <XFile?>[];
      await _open(tester, results);
      final controller = platform.controller;
      controller.finishPage();
      controller.ready();
      await _flush(tester);
      await tester.tap(find.byKey(_switchKey));
      await _flush(tester);
      controller.ready('environment');
      await _flush(tester);
      await tester.tap(find.byKey(_shutterKey));
      await _flush(tester);
      controller.emitCancelOnStop = true;
      controller.emit('error', {'code': 'capture'});
      await _flush(tester);
      expect(find.text(_labels.error), findsOneWidget);
      expect(controller.commands('stop'), 1);
      expect(results, isEmpty);
      controller.ready();
      controller.photo('environment');
      controller.emit('cancel');
      await _flush(tester);
      expect(find.text(_labels.error), findsOneWidget);
      expect(results, isEmpty);
      await tester.tap(find.byKey(_retryKey));
      await _flush(tester);
      final retryController = platform.controller;
      expect(platform.controllers, hasLength(2));
      expect(retryController.nonce, isNot(controller.nonce));
      expect(_shutterEnabled(tester), isFalse);
      controller.ready();
      controller.photo('environment');
      controller.emit('cancel');
      controller.navigation!.onPageStarted!('https://evil.example');
      controller.navigation!.onUrlChange!(
        const UrlChange(url: 'https://evil.example'),
      );
      expect(
        await controller.navigation!.onNavigationRequest!(
          const NavigationRequest(
            url: 'https://evil.example',
            isMainFrame: true,
          ),
        ),
        NavigationDecision.prevent,
      );
      controller.finishPage();
      final oldPermission = _PermissionRequest({
        WebViewPermissionResourceType.camera,
      });
      controller.onPermission!(oldPermission);
      await _flush(tester);
      expect(oldPermission.decisions, ['deny']);
      expect(results, isEmpty);
      expect(find.text(_labels.error), findsNothing);
      expect(_shutterEnabled(tester), isFalse);
      retryController.ready();
      await _flush(tester);
      expect(_shutterEnabled(tester), isTrue);
      await tester.tap(find.byKey(_shutterKey));
      await _flush(tester);
      retryController.photo();
      await _finishClosing(tester);
      expect(results, hasLength(1));
      expect(await results.single!.readAsBytes(), orderedEquals(_jpeg));
    },
  );

  testWidgets(
    'disposing the wrapper stops camera and ignores queued messages',
    (tester) async {
      final results = <XFile?>[];
      await _open(tester, results);
      final controller = platform.controller;
      controller.ready();
      await _flush(tester);
      await tester.pumpWidget(const SizedBox.shrink());
      await _flush(tester);
      expect(controller.commands('stop'), 1);
      controller.ready();
      controller.photo();
      await _flush(tester);
      expect(find.byType(PickupCameraScreen), findsNothing);
      expect(results, isEmpty);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'permission errors use guidance while other errors stay generic',
    (tester) async {
      const labels = PickupCameraLabels(
        title: 'Take pickup photo',
        capture: 'Take photo',
        switchCamera: 'Switch camera',
        close: 'Close camera',
        retry: 'Try camera again',
        error: 'Camera unavailable',
        permissionError: 'Allow camera access in settings',
      );
      final results = <XFile?>[];
      await _open(tester, results, labels: labels);
      platform.controller.emit('error', {'code': 'permission'});
      await _flush(tester);
      expect(find.text(labels.permissionError!), findsOneWidget);
      expect(find.text(labels.error), findsNothing);
      await tester.tap(find.byKey(_retryKey));
      await _flush(tester);
      platform.controller.emit('error', {'code': 'capture'});
      await _flush(tester);
      expect(find.text(labels.error), findsOneWidget);
      expect(find.text(labels.permissionError!), findsNothing);
      await tester.tap(find.byKey(_closeKey));
      await _finishClosing(tester);
    },
  );
}
