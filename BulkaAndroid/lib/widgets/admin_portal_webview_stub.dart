import 'package:flutter/material.dart';

import '../core/staff_push_bridge_contract.dart';

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
  Widget build(BuildContext context) => Semantics(
    label: semanticLabel,
    container: true,
    child: const SizedBox.expand(),
  );
}
