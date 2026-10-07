import 'dart:async';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_wkwebview/webview_flutter_wkwebview.dart';

import '../core/pickup_camera_protocol.dart';
import 'pickup_camera_types.dart';

bool get usesPickupCamera => defaultTargetPlatform == TargetPlatform.iOS;

Future<XFile?> capturePickupCamera(
  BuildContext context, {
  required PickupCameraLabels labels,
}) {
  if (!usesPickupCamera) return Future<XFile?>.value();
  return Navigator.of(context).push<XFile>(
    MaterialPageRoute<XFile>(
      builder: (_) => PickupCameraScreen(labels: labels),
    ),
  );
}

class PickupCameraScreen extends StatefulWidget {
  const PickupCameraScreen({
    super.key,
    required this.labels,
    this.openingTimeout = const Duration(seconds: 60),
    this.captureTimeout = const Duration(seconds: 15),
  });

  final PickupCameraLabels labels;
  final Duration openingTimeout;
  final Duration captureTimeout;

  @override
  State<PickupCameraScreen> createState() => _PickupCameraScreenState();
}

class _PickupCameraScreenState extends State<PickupCameraScreen>
    with WidgetsBindingObserver {
  late PickupCameraProtocol _protocol;
  WebViewController? _controller;
  Future<void> _messages = Future<void>.value();
  Timer? _timeout;
  bool _active = true;
  bool _busy = true;
  bool _failed = false;
  bool _permissionFailure = false;
  bool _trustedDocumentSeen = false;

  @override
  void initState() {
    super.initState();
    _protocol = _newProtocol();
    WidgetsBinding.instance.addObserver(this);
    _armTimeout(widget.openingTimeout);
    unawaited(_initialize());
  }

  PickupCameraProtocol _newProtocol() {
    final random = Random.secure();
    final nonce = List.generate(
      16,
      (_) => random.nextInt(256).toRadixString(16).padLeft(2, '0'),
    ).join();
    return PickupCameraProtocol(nonce);
  }

  bool _ownsSession(PickupCameraProtocol session) =>
      _active && mounted && identical(session, _protocol);

  Future<void> _initialize() async {
    final session = _protocol;
    try {
      final params = WebViewPlatform.instance is WebKitWebViewPlatform
          ? WebKitWebViewControllerCreationParams(
              allowsInlineMediaPlayback: true,
              mediaTypesRequiringUserAction: const <PlaybackMediaTypes>{},
            )
          : const PlatformWebViewControllerCreationParams();
      final controller = WebViewController.fromPlatformCreationParams(params);
      await controller.setJavaScriptMode(JavaScriptMode.unrestricted);
      await controller.setBackgroundColor(Colors.black);
      await controller.platform.setOnPlatformPermissionRequest((request) {
        unawaited(_decidePermission(session, controller, request));
      });
      await controller.addJavaScriptChannel(
        'BulkaPickupCamera',
        onMessageReceived: (message) {
          // Preserve ordering while the native current-URL check is pending.
          _messages = _messages.then(
            (_) => _receive(session, controller, message.message),
          );
        },
      );
      await controller.setNavigationDelegate(
        NavigationDelegate(
          onNavigationRequest: (request) {
            if (!_ownsSession(session) || _failed) {
              return NavigationDecision.prevent;
            }
            if (request.isMainFrame && session.trustsUrl(request.url)) {
              return NavigationDecision.navigate;
            }
            if (request.isMainFrame) _fail();
            return NavigationDecision.prevent;
          },
          onPageStarted: (url) {
            if (!_ownsSession(session) || _failed) return;
            if (!_protocol.trustsUrl(url)) {
              if (url == 'about:blank' && !_trustedDocumentSeen) return;
              _fail();
              return;
            }
            _trustedDocumentSeen = true;
            _protocol.beginStart();
            setState(() {
              _busy = true;
              _failed = false;
            });
            _armTimeout(widget.openingTimeout);
          },
          onPageFinished: (_) {
            if (!_ownsSession(session) || _failed) unawaited(_stop(controller));
          },
          onUrlChange: (change) {
            if (!_ownsSession(session) || _failed) return;
            if (_protocol.trustsUrl(change.url)) {
              _trustedDocumentSeen = true;
            } else if (change.url != null &&
                !(change.url == 'about:blank' && !_trustedDocumentSeen)) {
              _fail();
            }
          },
          onWebResourceError: (error) {
            if (_ownsSession(session) && error.isForMainFrame == true) _fail();
          },
          onHttpError: (error) {
            if (_ownsSession(session) &&
                error.response?.statusCode != null &&
                error.response!.statusCode >= 400 &&
                error.request?.uri != null &&
                _protocol.trustsUrl(error.request!.uri.toString())) {
              _fail();
            }
          },
        ),
      );
      if (!_active || !mounted || !identical(session, _protocol)) return;
      setState(() => _controller = controller);
      await controller.loadRequest(session.uri);
    } catch (_) {
      if (identical(session, _protocol)) _fail();
    }
  }

  Future<void> _decidePermission(
    PickupCameraProtocol session,
    WebViewController controller,
    PlatformWebViewPermissionRequest request,
  ) async {
    try {
      final url = await controller.currentUrl();
      if (_active &&
          !_failed &&
          identical(session, _protocol) &&
          mounted &&
          _protocol.trustsUrl(url) &&
          request.types.length == 1 &&
          request.types.contains(WebViewPermissionResourceType.camera)) {
        await request.grant();
      } else {
        await request.deny();
      }
    } catch (_) {
      try {
        await request.deny();
      } catch (_) {
        // A permission request may already belong to a disposed native view.
      }
    }
  }

  Future<void> _receive(
    PickupCameraProtocol session,
    WebViewController controller,
    String raw,
  ) async {
    if (!_ownsSession(session) || _failed) return;
    try {
      final url = await controller.currentUrl();
      if (!_ownsSession(session) || _failed || !session.trustsUrl(url)) return;
      final event = _protocol.receive(raw);
      if (event == null) return;
      switch (event.type) {
        case PickupCameraEventType.ready:
          _timeout?.cancel();
          setState(() {
            _busy = false;
            _failed = false;
          });
        case PickupCameraEventType.busy:
          setState(() {
            _busy = true;
            _failed = false;
          });
          _armTimeout(
            event.reason == 'capture'
                ? widget.captureTimeout
                : widget.openingTimeout,
          );
        case PickupCameraEventType.photo:
          _finish(
            XFile.fromData(
              event.bytes!,
              name: 'pickup.jpg',
              mimeType: 'image/jpeg',
            ),
          );
        case PickupCameraEventType.error:
          _fail(event.code);
        case PickupCameraEventType.cancel:
          _finish();
      }
    } catch (_) {
      _fail();
    }
  }

  void _armTimeout(Duration duration) {
    _timeout?.cancel();
    _timeout = Timer(duration, _fail);
  }

  void _fail([String? code]) {
    if (!_active || !mounted || _failed) return;
    _timeout?.cancel();
    _protocol.beginStart();
    setState(() {
      _busy = false;
      _failed = true;
      _permissionFailure = code == 'permission';
    });
    unawaited(_stop());
  }

  Future<void> _command(String command) async {
    final session = _protocol;
    final controller = _controller;
    if (!_active || controller == null) return;
    try {
      await controller.runJavaScript(
        'window.BulkaPickupCameraControls?.$command();',
      );
    } catch (_) {
      if (identical(session, _protocol)) _fail();
    }
  }

  Future<void> _stop([WebViewController? controller]) async {
    try {
      await (controller ?? _controller)?.runJavaScript(
        'window.BulkaPickupCameraControls?.stop();',
      );
    } catch (_) {
      // Closing a WebView may invalidate its controller before this completes.
    }
  }

  void _capture() {
    if (_failed || !_protocol.beginCapture()) return;
    setState(() => _busy = true);
    _armTimeout(widget.captureTimeout);
    unawaited(_command('capture'));
  }

  void _switch() {
    if (_failed || !_protocol.beginSwitch()) return;
    setState(() => _busy = true);
    _armTimeout(widget.openingTimeout);
    unawaited(_command('switchCamera'));
  }

  void _retry() {
    if (!_active) return;
    final previousController = _controller;
    _protocol.close();
    _protocol = _newProtocol();
    _trustedDocumentSeen = false;
    setState(() {
      _failed = false;
      _busy = true;
      _controller = null;
    });
    _armTimeout(widget.openingTimeout);
    if (previousController != null) unawaited(_stop(previousController));
    unawaited(_initialize());
  }

  void _finish([XFile? photo]) {
    if (!_active || !mounted) return;
    _deactivate();
    final route = ModalRoute.of(context);
    if (route?.isCurrent == true) {
      Navigator.of(context).pop(photo);
    } else if (route != null) {
      Navigator.of(context).removeRoute(route, photo);
    }
  }

  void _deactivate() {
    if (!_active) return;
    _active = false;
    _protocol.close();
    _timeout?.cancel();
    unawaited(_stop());
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.hidden ||
        state == AppLifecycleState.detached) {
      _finish();
    }
    // iOS camera permission prompts can make the app temporarily inactive.
  }

  @override
  void dispose() {
    _active = false;
    _protocol.close();
    _timeout?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    unawaited(_stop());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final labels = widget.labels;
    final ready = !_busy && !_failed && _protocol.ready != null;
    return PopScope<XFile>(
      onPopInvokedWithResult: (didPop, _) {
        if (didPop) _deactivate();
      },
      child: Scaffold(
        backgroundColor: Colors.black,
        body: Semantics(
          namesRoute: true,
          label: labels.title,
          child: SafeArea(
            child: Column(
              children: [
                Row(
                  children: [
                    Expanded(
                      child: TextButton(
                        key: const ValueKey('pickup-camera-close'),
                        onPressed: () => _finish(),
                        style: TextButton.styleFrom(
                          foregroundColor: Colors.white,
                        ),
                        child: Text(labels.close),
                      ),
                    ),
                    Expanded(
                      child: TextButton(
                        key: const ValueKey('pickup-camera-switch'),
                        onPressed: ready ? _switch : null,
                        style: TextButton.styleFrom(
                          foregroundColor: Colors.white,
                          disabledForegroundColor: Colors.white38,
                        ),
                        child: Text(labels.switchCamera),
                      ),
                    ),
                  ],
                ),
                Expanded(
                  child: Stack(
                    fit: StackFit.expand,
                    children: [
                      if (_controller != null)
                        WebViewWidget(controller: _controller!),
                      if (_busy && !_failed)
                        const Center(
                          child: CircularProgressIndicator(color: Colors.white),
                        ),
                      if (_failed)
                        ColoredBox(
                          color: Colors.black,
                          child: Center(
                            child: Padding(
                              padding: const EdgeInsets.all(24),
                              child: Column(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Text(
                                    _permissionFailure
                                        ? labels.permissionError ?? labels.error
                                        : labels.error,
                                    textAlign: TextAlign.center,
                                    style: const TextStyle(color: Colors.white),
                                  ),
                                  const SizedBox(height: 12),
                                  TextButton(
                                    key: const ValueKey('pickup-camera-retry'),
                                    onPressed: _retry,
                                    style: TextButton.styleFrom(
                                      foregroundColor: Colors.white,
                                    ),
                                    child: Text(labels.retry),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 20),
                  child: Tooltip(
                    message: labels.capture,
                    child: Semantics(
                      label: labels.capture,
                      button: true,
                      enabled: ready,
                      child: SizedBox.square(
                        dimension: 76,
                        child: FilledButton(
                          key: const ValueKey('pickup-camera-shutter'),
                          onPressed: ready ? _capture : null,
                          style: FilledButton.styleFrom(
                            padding: EdgeInsets.zero,
                            backgroundColor: Colors.white,
                            disabledBackgroundColor: Colors.white38,
                            shape: const CircleBorder(
                              side: BorderSide(color: Colors.white, width: 2),
                            ),
                          ),
                          child: const SizedBox.shrink(),
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
