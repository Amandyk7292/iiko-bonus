import 'package:flutter/material.dart';

class ForteCheckoutWebView extends StatelessWidget {
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
  Widget build(BuildContext context) =>
      Semantics(label: semanticLabel, child: const SizedBox.expand());
}
