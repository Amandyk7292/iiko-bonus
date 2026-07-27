import 'dart:async';

import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';

class ForteCheckoutWebView extends StatefulWidget {
  const ForteCheckoutWebView({
    required this.initialUri,
    required this.acceptLanguage,
    required this.semanticLabel,
    required this.isReturnUri,
    required this.onReturn,
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
  final bool Function(Uri uri) isReturnUri;
  final ValueChanged<Uri> onReturn;
  final ValueChanged<int> onProgress;
  final VoidCallback onReady;
  final VoidCallback onUnavailable;
  final Future<bool> Function(Uri uri) openExternalUri;
  final VoidCallback onExternalOpenFailed;

  @override
  State<ForteCheckoutWebView> createState() => _ForteCheckoutWebViewState();
}

class _ForteCheckoutWebViewState extends State<ForteCheckoutWebView> {
  WebViewController? _controller;
  bool _returnHandled = false;
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
          onPageFinished: (_) => widget.onReady(),
          onUrlChange: (change) => _observeUrl(change.url),
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

  NavigationDecision _handleNavigation(NavigationRequest request) {
    final uri = Uri.tryParse(request.url);
    if (uri == null) return NavigationDecision.prevent;
    if (widget.isReturnUri(uri)) {
      _complete(uri);
      return NavigationDecision.prevent;
    }

    final scheme = uri.scheme.toLowerCase();
    if (scheme == 'https' ||
        scheme == 'about' ||
        scheme == 'data' ||
        scheme == 'blob') {
      return NavigationDecision.navigate;
    }
    if (scheme.isNotEmpty && scheme != 'javascript' && scheme != 'file') {
      unawaited(_openExternal(uri));
    }
    return NavigationDecision.prevent;
  }

  void _observeUrl(String? rawUrl) {
    final uri = rawUrl == null ? null : Uri.tryParse(rawUrl);
    if (uri != null && widget.isReturnUri(uri)) _complete(uri);
  }

  void _complete(Uri uri) {
    if (_returnHandled) return;
    _returnHandled = true;
    widget.onReturn(uri);
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
      child: WebViewWidget(controller: controller),
    );
  }
}
