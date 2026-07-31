import 'dart:async';

import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';

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

  @override
  State<AdminPortalWebView> createState() => _AdminPortalWebViewState();
}

class _AdminPortalWebViewState extends State<AdminPortalWebView> {
  WebViewController? _controller;
  bool _unavailableReported = false;

  @override
  void initState() {
    super.initState();
    unawaited(_initialize());
  }

  Future<void> _initialize() async {
    try {
      final controller = WebViewController();
      await controller.setJavaScriptMode(JavaScriptMode.unrestricted);
      await controller.setBackgroundColor(Colors.white);
      await controller.setNavigationDelegate(
        NavigationDelegate(
          onProgress: widget.onProgress,
          onPageStarted: (_) {
            _unavailableReported = false;
          },
          onPageFinished: (_) async {
            widget.onReady();
            await _prepareEmbeddedNavigation(controller);
          },
          onNavigationRequest: _handleNavigation,
          onWebResourceError: (error) {
            if (error.isForMainFrame == true) _reportUnavailable();
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

  NavigationDecision _handleNavigation(NavigationRequest request) {
    if (request.isMainFrame == false) return NavigationDecision.navigate;
    final uri = Uri.tryParse(request.url);
    if (uri == null) return NavigationDecision.prevent;
    if (widget.isTrustedUri(uri)) return NavigationDecision.navigate;

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
