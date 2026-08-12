import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../core/staff_push_bridge_contract.dart';

class AdminPortalWebView extends StatefulWidget {
  const AdminPortalWebView({
    required this.initialUri,
    required this.acceptLanguage,
    required this.semanticLabel,
    required this.isTrustedUri,
    required this.onProgress,
    required this.onReady,
    required this.onUnavailable,
    required this.openExternalUri,
    required this.onExternalOpenFailed,
    this.onStaffPushBridgeRequest,
    this.staffPushTokenEvents,
    this.onStaffPushBridgeActivationChanged,
    super.key,
  });

  final Uri initialUri;
  final String acceptLanguage;
  final String semanticLabel;
  final bool Function(Uri uri) isTrustedUri;
  final ValueChanged<int> onProgress;
  final VoidCallback onReady;
  final VoidCallback onUnavailable;
  final Future<bool> Function(Uri uri) openExternalUri;
  final VoidCallback onExternalOpenFailed;
  final StaffPushBridgeHandler? onStaffPushBridgeRequest;
  final Stream<Map<String, Object?>>? staffPushTokenEvents;
  final ValueChanged<bool>? onStaffPushBridgeActivationChanged;

  @override
  State<AdminPortalWebView> createState() => _AdminPortalWebViewState();
}

class _AdminPortalWebViewState extends State<AdminPortalWebView> {
  WebViewController? _controller;
  StreamSubscription<Map<String, Object?>>? _staffTokenSubscription;
  bool _unavailableReported = false;
  String? _staffBridgeNonce;
  bool _staffBridgeActivated = false;
  bool _staffNativeChannelInstalled = false;
  bool _mainFrameLoading = false;
  String? _trustedNavigationBypassUrl;
  Future<void> _staffBridgeSync = Future<void>.value();

  void _setStaffBridgeActivated(bool active) {
    if (_staffBridgeActivated == active) return;
    _staffBridgeActivated = active;
    widget.onStaffPushBridgeActivationChanged?.call(active);
  }

  @override
  void initState() {
    super.initState();
    _staffTokenSubscription = widget.staffPushTokenEvents?.listen(
      (payload) => unawaited(_dispatchStaffToken(payload)),
    );
    unawaited(_initialize());
  }

  Future<void> _initialize() async {
    try {
      final controller = WebViewController();
      await controller.setJavaScriptMode(JavaScriptMode.unrestricted);
      await controller.setBackgroundColor(Colors.white);
      // Android exposes a JavaScript interface only to documents loaded after
      // it was registered. Install it before the initial kitchen request, not
      // from onPageFinished, while keeping every other route channel-free.
      await _setStaffNativeChannel(
        controller,
        _isTrustedStaffBridgeUri(widget.initialUri),
      );
      await controller.setNavigationDelegate(
        NavigationDelegate(
          onProgress: widget.onProgress,
          onPageStarted: (url) {
            _mainFrameLoading = true;
            _unavailableReported = false;
            _staffBridgeNonce = null;
            _setStaffBridgeActivated(false);
            final uri = Uri.tryParse(url);
            if (uri == null || !_isTrustedStaffBridgeUri(uri)) {
              unawaited(_scheduleStaffPushBridge(controller, 'about:blank'));
            }
          },
          onPageFinished: (url) async {
            _mainFrameLoading = false;
            widget.onReady();
            await _prepareEmbeddedNavigation(controller);
            await _scheduleStaffPushBridge(controller, url);
          },
          onNavigationRequest: (request) =>
              _handleNavigation(controller, request),
          onUrlChange: (change) {
            final uri = change.url == null ? null : Uri.tryParse(change.url!);
            if (uri == null || !_isTrustedStaffBridgeUri(uri)) {
              _staffBridgeNonce = null;
              _setStaffBridgeActivated(false);
            }
            // A full navigation announces after page finish, when the React
            // listener exists. onUrlChange remains the SPA transition hook.
            if (!_mainFrameLoading && change.url != null) {
              unawaited(_scheduleStaffPushBridge(controller, change.url!));
            }
          },
          onWebResourceError: (error) {
            if (error.isForMainFrame == true) {
              _mainFrameLoading = false;
              _reportUnavailable();
            }
          },
        ),
      );
      if (!mounted) return;
      setState(() => _controller = controller);
      await controller.loadRequest(
        widget.initialUri,
        headers: {'Accept-Language': widget.acceptLanguage},
      );
    } catch (_) {
      _reportUnavailable();
    }
  }

  String _newBridgeNonce() {
    final random = Random.secure();
    final bytes = List<int>.generate(24, (_) => random.nextInt(256));
    return base64UrlEncode(bytes).replaceAll('=', '');
  }

  bool _isTrustedStaffBridgeUri(Uri uri) {
    return widget.isTrustedUri(uri) && isStaffPushBridgePath(uri.path);
  }

  bool _isTrustedAdminUri(Uri uri) {
    return widget.isTrustedUri(uri) && isStaffPushCapabilityPath(uri.path);
  }

  String get _nativePlatform => switch (defaultTargetPlatform) {
    TargetPlatform.iOS => 'ios',
    TargetPlatform.android => 'android',
    _ => 'unknown',
  };

  Future<bool> _isCurrentStaffBridgePage(
    WebViewController controller, {
    String? expectedNonce,
  }) async {
    if (expectedNonce != null && _staffBridgeNonce != expectedNonce) {
      return false;
    }
    final currentUrl = await controller.currentUrl();
    final uri = currentUrl == null ? null : Uri.tryParse(currentUrl);
    return uri != null && _isTrustedStaffBridgeUri(uri);
  }

  Future<void> _setStaffNativeChannel(
    WebViewController controller,
    bool installed,
  ) async {
    if (widget.onStaffPushBridgeRequest == null ||
        _staffNativeChannelInstalled == installed) {
      return;
    }
    if (!installed) {
      _staffNativeChannelInstalled = false;
      try {
        await controller.removeJavaScriptChannel(staffPushNativeChannel);
      } catch (_) {}
      return;
    }
    await controller.addJavaScriptChannel(
      staffPushNativeChannel,
      onMessageReceived: (message) =>
          unawaited(_handleStaffPushRequest(controller, message.message)),
    );
    _staffNativeChannelInstalled = true;
  }

  Future<void> _scheduleStaffPushBridge(
    WebViewController controller,
    String rawUrl,
  ) {
    final next = _staffBridgeSync
        .catchError((Object _) {})
        .then((_) => _prepareStaffPushBridge(controller, rawUrl));
    _staffBridgeSync = next.catchError((Object _) {});
    return next;
  }

  Future<void> _prepareStaffPushBridge(
    WebViewController controller,
    String rawUrl,
  ) async {
    if (widget.onStaffPushBridgeRequest == null) return;
    final channelInstalledAtStart = _staffNativeChannelInstalled;
    final uri = Uri.tryParse(rawUrl);
    if (uri == null || !_isTrustedAdminUri(uri)) {
      _staffBridgeNonce = null;
      _setStaffBridgeActivated(false);
      await _setStaffNativeChannel(controller, false);
      return;
    }
    var exposeRequestBridge = _isTrustedStaffBridgeUri(uri);
    try {
      await _setStaffNativeChannel(controller, exposeRequestBridge);
    } catch (_) {
      exposeRequestBridge = false;
    }
    final currentUrl = await controller.currentUrl();
    final currentUri = currentUrl == null ? null : Uri.tryParse(currentUrl);
    if (currentUri == null || !_isTrustedAdminUri(currentUri)) {
      _staffBridgeNonce = null;
      _setStaffBridgeActivated(false);
      await _setStaffNativeChannel(controller, false);
      return;
    }
    exposeRequestBridge = _isTrustedStaffBridgeUri(currentUri);
    try {
      await _setStaffNativeChannel(controller, exposeRequestBridge);
    } catch (_) {
      exposeRequestBridge = false;
    }
    if (defaultTargetPlatform == TargetPlatform.android &&
        channelInstalledAtStart != _staffNativeChannelInstalled) {
      // add/removeJavascriptInterface is reflected in Android JavaScript only
      // after a document reload. This branch is reached for SPA history
      // transitions; full navigations are configured before load below.
      _staffBridgeNonce = null;
      _setStaffBridgeActivated(false);
      try {
        await controller.reload();
      } catch (_) {}
      return;
    }
    final nonce = exposeRequestBridge ? _newBridgeNonce() : null;
    _staffBridgeNonce = nonce;
    if (!exposeRequestBridge) _setStaffBridgeActivated(false);
    try {
      await controller.runJavaScript(
        buildStaffPushBridgeBootstrap(
          platform: _nativePlatform,
          nonce: nonce,
          exposeRequestBridge: exposeRequestBridge,
        ),
      );
    } catch (_) {
      if (nonce != null && _staffBridgeNonce == nonce) {
        _staffBridgeNonce = null;
      }
    }
  }

  Future<void> _handleStaffPushRequest(
    WebViewController controller,
    String raw,
  ) async {
    final nonce = _staffBridgeNonce;
    final handler = widget.onStaffPushBridgeRequest;
    if (nonce == null || handler == null) return;
    if (!await _isCurrentStaffBridgePage(controller, expectedNonce: nonce)) {
      return;
    }
    final request = StaffPushBridgeRequest.tryParse(raw, expectedNonce: nonce);
    if (request == null) return;

    Map<String, Object?> result;
    try {
      result = await handler(request);
    } catch (_) {
      result = {
        'ok': false,
        'permission': 'unknown',
        'platform': _nativePlatform,
        'installationId': 'unavailable',
        'staffEnrollmentIntent': false,
        'error': 'native_unavailable',
      };
    }
    if (!await _isCurrentStaffBridgePage(controller, expectedNonce: nonce)) {
      return;
    }
    if (request.action == StaffPushBridgeAction.register) {
      _setStaffBridgeActivated(result['ok'] == true);
    } else if (request.action == StaffPushBridgeAction.unregister) {
      _setStaffBridgeActivated(false);
    } else if (request.action == StaffPushBridgeAction.status) {
      _setStaffBridgeActivated(result['staffEnrollmentIntent'] == true);
    }
    await _dispatchStaffEvent(controller, staffPushBridgeResponseEvent, {
      'version': staffPushBridgeVersion,
      'requestId': request.requestId,
      'action': request.action.wireName,
      ...result,
    });
  }

  Future<void> _dispatchStaffToken(Map<String, Object?> payload) async {
    final controller = _controller;
    final nonce = _staffBridgeNonce;
    if (!_staffBridgeActivated || controller == null || nonce == null) return;
    if (!await _isCurrentStaffBridgePage(controller, expectedNonce: nonce)) {
      _setStaffBridgeActivated(false);
      return;
    }
    await _dispatchStaffEvent(controller, staffPushBridgeTokenEvent, payload);
  }

  Future<void> _dispatchStaffEvent(
    WebViewController controller,
    String eventName,
    Map<String, Object?> payload,
  ) async {
    final eventJson = jsonEncode(eventName);
    final payloadJson = jsonEncode(
      payload,
    ).replaceAll('\u2028', r'\u2028').replaceAll('\u2029', r'\u2029');
    try {
      await controller.runJavaScript(
        'window.dispatchEvent(new CustomEvent($eventJson, '
        '{ detail: $payloadJson }));',
      );
    } catch (_) {
      // Navigation can dispose the page while a native request is completing.
    }
  }

  Future<void> _prepareEmbeddedNavigation(WebViewController controller) async {
    try {
      await controller.runJavaScript(r'''
        (() => {
          if (window.__bulkaAdminEmbeddedNavigation) return;
          window.__bulkaAdminEmbeddedNavigation = true;
          document.addEventListener('click', (event) => {
            const target = event.target;
            const link = target && target.closest
              ? target.closest('a[target="_blank"]')
              : null;
            if (!link || !link.href) return;
            event.preventDefault();
            window.location.assign(link.href);
          }, true);
        })();
      ''');
    } catch (_) {
      // The admin remains usable if a page blocks this optional enhancement.
    }
  }

  NavigationDecision _handleNavigation(
    WebViewController controller,
    NavigationRequest request,
  ) {
    if (request.isMainFrame == false) return NavigationDecision.navigate;
    final uri = Uri.tryParse(request.url);
    if (uri == null) return NavigationDecision.prevent;
    if (widget.isTrustedUri(uri)) {
      if (_trustedNavigationBypassUrl == request.url) {
        _trustedNavigationBypassUrl = null;
        return NavigationDecision.navigate;
      }
      final shouldInstallChannel =
          widget.onStaffPushBridgeRequest != null &&
          _isTrustedStaffBridgeUri(uri);
      if (_staffNativeChannelInstalled != shouldInstallChannel) {
        unawaited(
          _navigateTrustedWithStaffChannel(
            controller,
            uri,
            shouldInstallChannel: shouldInstallChannel,
          ),
        );
        return NavigationDecision.prevent;
      }
      return NavigationDecision.navigate;
    }

    final scheme = uri.scheme.toLowerCase();
    if (scheme == 'about' && uri.toString() == 'about:blank') {
      return NavigationDecision.navigate;
    }
    if (const {
      'https',
      'mailto',
      'tel',
      'sms',
      'whatsapp',
      'tg',
    }.contains(scheme)) {
      unawaited(_openExternal(uri));
    }
    return NavigationDecision.prevent;
  }

  Future<void> _navigateTrustedWithStaffChannel(
    WebViewController controller,
    Uri uri, {
    required bool shouldInstallChannel,
  }) async {
    final next = _staffBridgeSync.catchError((Object _) {}).then((_) async {
      try {
        await _setStaffNativeChannel(controller, shouldInstallChannel);
      } catch (_) {
        // The trusted admin page must remain usable. It will still receive the
        // capability-only bootstrap and fail closed for native operations.
      }
      _trustedNavigationBypassUrl = uri.toString();
      await controller.loadRequest(
        uri,
        headers: {'Accept-Language': widget.acceptLanguage},
      );
    });
    _staffBridgeSync = next.catchError((Object _) {});
    await next;
  }

  Future<void> _openExternal(Uri uri) async {
    try {
      final opened = await widget.openExternalUri(uri);
      if (!opened) widget.onExternalOpenFailed();
    } catch (_) {
      widget.onExternalOpenFailed();
    }
  }

  void _reportUnavailable() {
    if (_unavailableReported) return;
    _unavailableReported = true;
    widget.onUnavailable();
  }

  @override
  void dispose() {
    _staffTokenSubscription?.cancel();
    _staffBridgeNonce = null;
    _setStaffBridgeActivated(false);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final controller = _controller;
    if (controller == null) {
      return const Center(
        child: CircularProgressIndicator(color: Color(0xFFFFB814)),
      );
    }
    return Semantics(
      label: widget.semanticLabel,
      container: true,
      child: WebViewWidget(controller: controller),
    );
  }
}
