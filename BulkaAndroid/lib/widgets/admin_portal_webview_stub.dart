import 'package:flutter/material.dart';

class AdminPortalWebView extends StatelessWidget {
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
  Widget build(BuildContext context) => Semantics(
    label: semanticLabel,
    container: true,
    child: const SizedBox.expand(),
  );
}
