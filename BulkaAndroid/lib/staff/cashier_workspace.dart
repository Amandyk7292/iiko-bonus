part of '../main.dart';

/// Branch-scoped cashier workspace. Scope and allowed mutations
/// still come from the server, not from hidden navigation items.
class CashierWorkspace extends StatefulWidget {
  const CashierWorkspace({
    required this.api,
    required this.user,
    required this.onLogout,
    this.kitchenRequest = 0,
    this.nativePushEnabled = true,
    super.key,
  });
  final StaffApiClient api;
  final Map<String, dynamic> user;
  final Future<void> Function() onLogout;
  final int kitchenRequest;
  @visibleForTesting
  final bool nativePushEnabled;

  @override
  State<CashierWorkspace> createState() => _CashierWorkspaceState();
}

class _CashierWorkspaceState extends State<CashierWorkspace>
    with SingleTickerProviderStateMixin {
  late final AnimationController _transition;
  StaffNativePush? _push;
  int _tab = 0;
  bool _loading = true, _signingOut = false;
  String? _error;
  String _branchName = '';

  @override
  void initState() {
    super.initState();
    _transition = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 220),
      value: 1,
    );
    _tab = widget.kitchenRequest > 0 ? 1 : 0;
    if (widget.user['role'] != 'cashier') return;
    unawaited(_loadScope());
    if (!kIsWeb && widget.nativePushEnabled) {
      _push = StaffNativePush(widget.api);
      unawaited(_enrollPush());
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) PushNotifications.listenForeground(context);
      });
    }
  }

  Future<void> _enrollPush() async {
    final prefs = await SharedPreferences.getInstance();
    if (!mounted || prefs.getBool('staffPushSetupCompleted') == true) return;
    // One-time enrollment on entering the cashier account. OS permission is
    // requested only if undecided; a later explicit mute remains respected.
    // Persist the intended enrollment before contacting Firebase/server, so a
    // first-login outage can recover silently. Explicit disable clears it.
    await StaffPushEnrollmentStore.write(true);
    await prefs.setBool('staffPushSetupCompleted', true);
    if (mounted) await _push?.synchronize(user: true);
  }

  @override
  void didUpdateWidget(covariant CashierWorkspace oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.kitchenRequest != widget.kitchenRequest) _tab = 1;
  }

  Future<void> _loadScope() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final result = await widget.api.request('/scope');
      if (!mounted) return;
      final locations = (result['locations'] as List? ?? const [])
          .whereType<Map>()
          .where((row) => '${row['id'] ?? ''}'.isNotEmpty)
          .toList();
      if (locations.isEmpty) {
        throw StateError(
          staffText(
            'Филиал не назначен. Обратитесь к администратору.',
            'Филиал тағайындалмаған. Әкімшіге хабарласыңыз.',
            'No branch assigned. Contact the administrator.',
          ),
        );
      }
      final selected = '${result['selectedBranchId'] ?? ''}';
      final branch =
          locations.where((row) => '${row['id']}' == selected).firstOrNull ??
          locations.first;
      widget.api.branchId = '${branch['id']}';
      widget.api.branchIds = [];
      _branchName = '${branch['name'] ?? branch['title'] ?? ''}';
    } catch (error) {
      if (mounted) _error = '$error';
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _logout() async {
    if (_signingOut) return;
    setState(() => _signingOut = true);
    try {
      await widget.onLogout();
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('$error')));
      }
    } finally {
      if (mounted) setState(() => _signingOut = false);
    }
  }

  Future<void> _showPush() => showModalBottomSheet<void>(
    context: context,
    showDragHandle: true,
    isScrollControlled: true,
    builder: (_) => SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
        child: SingleChildScrollView(child: StaffPushPanel(push: _push!)),
      ),
    ),
  );

  @override
  Widget build(BuildContext context) {
    final orders = staffText('Заказы', 'Тапсырыстар', 'Orders');
    final kitchen = staffText('Кухня', 'Асүй', 'Kitchen');
    final catalog = staffText('Стоп-лист', 'Стоп-тізім', 'Stop list');
    if (widget.user['role'] != 'cashier') return const SizedBox.shrink();
    return Theme(
      data: staffTheme().copyWith(textTheme: Theme.of(context).textTheme),
      child: Scaffold(
        appBar: AppBar(
          automaticallyImplyLeading: false,
          title: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                [orders, kitchen, catalog][_tab],
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.w700,
                ),
              ),
              if (_branchName.isNotEmpty)
                Text(
                  _branchName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 12),
                ),
            ],
          ),
          actions: [
            if (_push != null)
              ListenableBuilder(
                listenable: _push!,
                builder: (_, _) => IconButton(
                  tooltip: staffText(
                    'Уведомления',
                    'Хабарландырулар',
                    'Notifications',
                  ),
                  onPressed: _showPush,
                  icon: Icon(
                    _push!.enabled
                        ? Icons.notifications_active_outlined
                        : Icons.notifications_off_outlined,
                  ),
                ),
              ),
            IconButton(
              tooltip: staffText('Выйти', 'Шығу', 'Sign out'),
              onPressed: _signingOut ? null : _logout,
              icon: const Icon(Icons.logout_rounded),
            ),
          ],
        ),
        body: _loading
            ? const Center(child: CircularProgressIndicator())
            : _error != null
            ? _StaffError(message: _error!, onRetry: _loadScope)
            : FadeTransition(
                opacity: _transition,
                child: IndexedStack(
                  index: _tab,
                  children: [
                    StaffOrders(
                      key: ValueKey('cashier-orders:${widget.api.scopeKey}'),
                      api: widget.api,
                      role: 'cashier',
                    ),
                    // Keep the kitchen mounted while viewing orders so its live feed
                    // and foreground alarm continue until paid orders are accepted.
                    StaffKitchen(
                      key: ValueKey('cashier-kitchen:${widget.api.scopeKey}'),
                      api: widget.api,
                      canEdit: true,
                    ),
                    CashierCatalog(
                      key: ValueKey('cashier-catalog:${widget.api.scopeKey}'),
                      api: widget.api,
                    ),
                  ],
                ),
              ),
        bottomNavigationBar: DecoratedBox(
          decoration: const BoxDecoration(
            color: Colors.white,
            border: Border(top: BorderSide(color: Color(0xFFECE6DF))),
          ),
          child: NavigationBar(
            selectedIndex: _tab,
            onDestinationSelected: (index) {
              if (index == _tab) return;
              setState(() => _tab = index);
              if (MediaQuery.disableAnimationsOf(context)) {
                _transition.value = 1;
              } else {
                _transition.forward(from: 0);
              }
            },
            destinations: [
              NavigationDestination(
                icon: const Icon(Icons.receipt_long_outlined),
                label: orders,
              ),
              NavigationDestination(
                icon: const Icon(Icons.soup_kitchen_outlined),
                label: kitchen,
              ),
              NavigationDestination(
                icon: const Icon(Icons.inventory_2_outlined),
                label: catalog,
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  void dispose() {
    _transition.dispose();
    _push?.dispose();
    super.dispose();
  }
}
