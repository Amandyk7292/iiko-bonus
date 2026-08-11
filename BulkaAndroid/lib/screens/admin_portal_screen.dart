part of '../main.dart';

Uri bulkaAdminPortalUri({String? baseUrl}) {
  final parsed = Uri.tryParse(baseUrl ?? _apiBaseUrl);
  final base = parsed != null && parsed.hasScheme && parsed.host.isNotEmpty
      ? parsed
      : Uri.https('bulka.com.kz', '/');
  return base.replace(
    path: '/admin/',
    queryParameters: const {'embedded': 'app'},
    fragment: null,
  );
}

bool isTrustedAdminPortalUri(Uri uri, Uri portalUri) {
  if (uri.scheme.toLowerCase() != portalUri.scheme.toLowerCase()) return false;
  if (uri.host.toLowerCase() != portalUri.host.toLowerCase()) return false;
  return uri.port == portalUri.port;
}

Future<void> openAdminPortal(BuildContext context) async {
  final uri = bulkaAdminPortalUri();
  if (kIsWeb) {
    navigateCurrentWindow(uri);
    return;
  }
  await Navigator.of(context).push<void>(
    MaterialPageRoute(
      settings: const RouteSettings(name: 'admin-portal'),
      fullscreenDialog: true,
      builder: (_) => AdminPortalScreen(initialUri: uri),
    ),
  );
}

class AdminPortalLoginButton extends StatelessWidget {
  const AdminPortalLoginButton({required this.enabled, super.key});

  final bool enabled;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 4),
      child: TextButton.icon(
        key: const ValueKey('admin-portal-login-button'),
        onPressed: enabled ? () => unawaited(openAdminPortal(context)) : null,
        icon: const Icon(Icons.admin_panel_settings_outlined, size: 20),
        label: Text('admin_portal_staff_login'.tr),
      ),
    );
  }
}

class AdminPortalScreen extends StatefulWidget {
  const AdminPortalScreen({required this.initialUri, super.key});

  final Uri initialUri;

  @override
  State<AdminPortalScreen> createState() => _AdminPortalScreenState();
}

class _AdminPortalScreenState extends State<AdminPortalScreen>
    with WidgetsBindingObserver {
  int _progress = 0;
  int _retryKey = 0;
  bool _ready = false;
  bool _failed = false;
  late final AdminPortalWakelockController _wakelockController;
  bool _wakelockEligible = false;
  bool _wakelockRequested = false;

  @override
  void initState() {
    super.initState();
    _wakelockController = AdminPortalWakelockController();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _wakelockEligible = shouldKeepAdminPortalAwake(
      screenSize: MediaQuery.sizeOf(context),
      platform: defaultTargetPlatform,
    );
    final lifecycleState = WidgetsBinding.instance.lifecycleState;
    _requestWakelock(
      _wakelockEligible &&
          (lifecycleState == null ||
              lifecycleState == AppLifecycleState.resumed),
    );
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _requestWakelock(_wakelockEligible && state == AppLifecycleState.resumed);
  }

  void _requestWakelock(bool active) {
    if (_wakelockRequested == active) return;
    _wakelockRequested = active;
    unawaited(_wakelockController.setActive(active));
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _wakelockRequested = false;
    unawaited(_wakelockController.dispose());
    super.dispose();
  }

  Future<bool> _openExternal(Uri uri) {
    return launchUrl(uri, mode: LaunchMode.externalApplication);
  }

  void _showExternalOpenError() {
    if (!mounted) return;
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text('admin_portal_external_error'.tr)));
  }

  void _retry() {
    setState(() {
      _progress = 0;
      _ready = false;
      _failed = false;
      _retryKey++;
    });
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    final scheme = Theme.of(context).colorScheme;
    final showProgress = !_failed && (!_ready || _progress < 100);
    return Scaffold(
      backgroundColor: scheme.surface,
      appBar: AppBar(
        toolbarHeight: 60,
        automaticallyImplyLeading: false,
        backgroundColor: scheme.surface,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        titleSpacing: 16,
        title: Row(
          children: [
            Container(
              width: 38,
              height: 38,
              padding: const EdgeInsets.all(6),
              decoration: BoxDecoration(
                color: colors.surfaceCream,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: colors.cardBorder),
              ),
              child: Image.asset(
                'assets/brand/bulka_logo.png',
                fit: BoxFit.contain,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    'admin_portal_title'.tr,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: colors.brandBrown,
                      fontFamily: _headingFont,
                      fontSize: BulkaTypeScale.titleSmall,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  Text(
                    'admin_portal_secure'.tr,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: colors.mutedText,
                      fontSize: BulkaTypeScale.caption,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
        actions: [
          IconButton(
            key: const ValueKey('admin-portal-close'),
            onPressed: () => Navigator.of(context).pop(),
            tooltip: 'close'.tr,
            icon: Icon(Icons.close_rounded, color: colors.brandBrown),
          ),
          const SizedBox(width: 4),
        ],
        bottom: showProgress
            ? PreferredSize(
                preferredSize: const Size.fromHeight(3),
                child: LinearProgressIndicator(
                  minHeight: 3,
                  value: _progress > 0 ? _progress / 100 : null,
                  backgroundColor: colors.cardBorder,
                  color: colors.brandGold,
                ),
              )
            : null,
      ),
      body: SafeArea(
        top: false,
        child: Stack(
          fit: StackFit.expand,
          children: [
            if (!_failed)
              AdminPortalWebView(
                key: ValueKey('admin-portal-webview-$_retryKey'),
                initialUri: widget.initialUri,
                acceptLanguage: AppLang.current,
                semanticLabel: 'admin_portal_semantics'.tr,
                isTrustedUri: (uri) =>
                    isTrustedAdminPortalUri(uri, widget.initialUri),
                onProgress: (value) {
                  if (!mounted) return;
                  setState(() => _progress = value.clamp(0, 100));
                },
                onReady: () {
                  if (!mounted) return;
                  setState(() {
                    _ready = true;
                    _progress = 100;
                  });
                },
                onUnavailable: () {
                  if (!mounted) return;
                  setState(() => _failed = true);
                },
                openExternalUri: _openExternal,
                onExternalOpenFailed: _showExternalOpenError,
              ),
            if (_failed)
              _AdminPortalErrorState(
                onRetry: _retry,
                onOpenBrowser: () => _openExternal(widget.initialUri),
              ),
          ],
        ),
      ),
    );
  }
}

class _AdminPortalErrorState extends StatelessWidget {
  const _AdminPortalErrorState({
    required this.onRetry,
    required this.onOpenBrowser,
  });

  final VoidCallback onRetry;
  final Future<bool> Function() onOpenBrowser;

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: Container(
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(
              color: colors.surfaceCream,
              borderRadius: BorderRadius.circular(BulkaRadii.card),
              border: Border.all(color: colors.cardBorder),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 56,
                  height: 56,
                  decoration: BoxDecoration(
                    color: colors.brandGold.withValues(alpha: 0.18),
                    shape: BoxShape.circle,
                  ),
                  child: Icon(
                    Icons.cloud_off_rounded,
                    color: colors.brandBrown,
                    size: 28,
                  ),
                ),
                const SizedBox(height: 18),
                Text(
                  'admin_portal_error_title'.tr,
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: colors.brandBrown,
                    fontFamily: _headingFont,
                    fontSize: BulkaTypeScale.title,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  'admin_portal_error_body'.tr,
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: colors.mutedText,
                    fontSize: BulkaTypeScale.body,
                    height: 1.4,
                  ),
                ),
                const SizedBox(height: 22),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton.icon(
                    onPressed: onRetry,
                    icon: const Icon(Icons.refresh_rounded),
                    label: Text('retry'.tr),
                  ),
                ),
                const SizedBox(height: 8),
                SizedBox(
                  width: double.infinity,
                  child: TextButton.icon(
                    onPressed: () => unawaited(onOpenBrowser()),
                    icon: const Icon(Icons.open_in_browser_rounded),
                    label: Text('admin_portal_open_browser'.tr),
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
