part of '../main.dart';

class StaffWorkspace extends StatefulWidget {
  const StaffWorkspace({
    required this.api,
    required this.user,
    required this.onLogout,
    this.initialSection = 'kitchen',
    super.key,
  });
  final StaffApiClient api;
  final Map<String, dynamic> user;
  final Future<void> Function() onLogout;
  final String initialSection;
  @override
  State<StaffWorkspace> createState() => _StaffWorkspaceState();
}

class _StaffWorkspaceState extends State<StaffWorkspace> {
  String _section = 'kitchen';
  final _taplinkKey = GlobalKey<_StaffTaplinkState>();
  final _broadcastKey = GlobalKey<_StaffBroadcastState>();
  bool _allowClose = false;
  Future<bool> _canLeave() async {
    final broadcast = _broadcastKey.currentState;
    final dirty =
        _taplinkKey.currentState?._dirty == true ||
        (broadcast != null &&
            [
              ...broadcast._titles.values,
              ...broadcast._bodies.values,
            ].any((c) => c.text.isNotEmpty));
    if (_taplinkKey.currentState?._busy == true || broadcast?._busy == true) {
      return false;
    }
    return !dirty || await staffConfirmDiscard(context);
  }

  Future<void> _navigate(String section) async {
    if (!_sections.containsKey(section) || !await _canLeave() || !mounted) {
      return;
    }
    setState(() => _section = section);
  }

  Future<void> _close() async {
    if (!await _canLeave() || !mounted) return;
    setState(() => _allowClose = true);
    await Future<void>.delayed(Duration.zero);
    if (mounted) Navigator.pop(context);
  }

  StaffNativePush? _push;
  String _selectedCity = '';
  bool _cashierCatalogAvailable = false;
  String? _error;
  bool _loading = true, _signingOut = false;
  List<Map<String, dynamic>> _locations = [];
  String get _role => '${widget.user['role']}';
  Set<String> get _actions => ((widget.user['actions'] as List?) ?? const [])
      .whereType<String>()
      .toSet();
  bool _can(String action) =>
      _actions.contains('*') || _actions.contains(action);
  bool get _dashboardAllowed => ['owner', 'admin'].contains(_role);
  bool get _contentAllowed =>
      ['owner', 'admin', 'marketer', 'editor'].contains(_role);
  bool get _ordersAllowed => _kitchenAllowed;
  bool get _whatsappAllowed =>
      _dashboardAllowed ||
      [
        'branch_manager',
        'operator',
        'editor',
        'viewer',
        'whatsapp_operator',
      ].contains(_role);
  bool get _menuAllowed =>
      _dashboardAllowed ||
      (['branch_manager', 'editor', 'viewer'].contains(_role) ||
          (_role == 'cashier' && _cashierCatalogAvailable));
  bool get _operationsAllowed => [
    'owner',
    'admin',
    'branch_manager',
    'operator',
    'marketer',
    'editor',
    'viewer',
  ].contains(_role);
  bool get _analyticsAllowed => [
    'owner',
    'admin',
    'branch_manager',
    'marketer',
    'editor',
    'viewer',
  ].contains(_role);
  bool get _transactionsAllowed =>
      ['owner', 'admin', 'branch_manager', 'editor', 'viewer'].contains(_role);
  bool get _kitchenAllowed => [
    'owner',
    'admin',
    'branch_manager',
    'operator',
    'editor',
    'viewer',
    'cashier',
  ].contains(_role);
  Map<String, String> get _sections => {
    if (_operationsAllowed)
      'operations': staffText(
        'Операционный центр',
        'Операциялық орталық',
        'Operations',
      ),
    if (_analyticsAllowed)
      'analytics': staffText('Аналитика', 'Талдау', 'Analytics'),
    if (_ordersAllowed) 'orders': staffText('Заказы', 'Тапсырыстар', 'Orders'),
    if (_transactionsAllowed)
      'transactions': staffText('Транзакции', 'Транзакциялар', 'Transactions'),
    if (_dashboardAllowed) 'iiko': 'iiko Front',
    if (_menuAllowed) 'menu': staffText('Меню', 'Мәзір', 'Menu'),
    if (_dashboardAllowed)
      'dispatch': staffText('Доставка', 'Жеткізу', 'Dispatch'),
    if (_whatsappAllowed) 'whatsapp': 'WhatsApp',
    if (_contentAllowed) ...{
      'marketing': staffText('Маркетинг', 'Маркетинг', 'Marketing'),
      'tiers': staffText(
        'Уровни лояльности',
        'Адалдық деңгейлері',
        'Loyalty tiers',
      ),
      'contacts': staffText('Контакты', 'Байланыстар', 'Contacts'),
      'broadcast': staffText('Рассылка', 'Хабарландыру', 'Broadcast'),
      'taplink': 'Taplink',
    },
    if (_transactionsAllowed)
      'integrations': staffText('Интеграции', 'Интеграциялар', 'Integrations'),
    if (_dashboardAllowed) ...{
      'security': staffText('Безопасность', 'Қауіпсіздік', 'Security'),
      'site-access': staffText(
        'Сайт и онлайн-заказы',
        'Сайт және онлайн тапсырыстар',
        'Website and ordering',
      ),
    },
    if (_dashboardAllowed)
      'couriers': staffText('Курьеры', 'Курьерлер', 'Couriers'),
    if (_dashboardAllowed ||
        (['branch_manager', 'editor', 'viewer'].contains(_role) ||
            (_role == 'cashier' && _cashierCatalogAvailable)))
      'inventory': staffText('Остатки', 'Қалдықтар', 'Inventory'),
    if (_operationsAllowed)
      'support': staffText('Поддержка', 'Қолдау', 'Support'),
    if (_dashboardAllowed)
      'reviews': staffText('Отзывы', 'Пікірлер', 'Reviews'),
    if (_contentAllowed) 'stories': staffText('Истории', 'Оқиғалар', 'Stories'),
    if (_contentAllowed) 'news': staffText('Новости', 'Жаңалықтар', 'News'),
    if (_contentAllowed)
      'bonus': staffText(
        'Бонусная программа',
        'Бонус бағдарламасы',
        'Bonus program',
      ),
    if (_dashboardAllowed)
      'settings': staffText('Настройки', 'Баптаулар', 'Settings'),
    if (_dashboardAllowed)
      'access': staffText(
        'Доступ сотрудников',
        'Қызметкерлер рұқсаты',
        'Staff access',
      ),
    if (_transactionsAllowed)
      'locations': staffText('Локации', 'Локациялар', 'Locations'),
    if (_kitchenAllowed) 'kitchen': staffText('Кухня', 'Асүй', 'Kitchen'),
    if (_dashboardAllowed) 'dashboard': 'iiko Dashboard',
    if (_can('customers:read'))
      'customers': staffText('Клиенты', 'Клиенттер', 'Customers'),
  };

  @override
  void initState() {
    super.initState();
    _section = _sections.containsKey(widget.initialSection)
        ? widget.initialSection
        : (_sections.keys.firstOrNull ?? '');
    if (_role == 'cashier' && !kIsWeb) _push = StaffNativePush(widget.api);
    unawaited(_scope());
  }

  Future<void> _scope() async {
    if (_role == 'whatsapp_operator') {
      setState(() => _loading = false);
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final result = await widget.api.request('/scope');
      if (_role == 'cashier') {
        try {
          final catalog = await widget.api.request('/staff/catalog');
          _cashierCatalogAvailable = catalog['products'] is List;
        } on StaffApiException catch (e) {
          if (e.status != 404 && e.status != 403) rethrow;
          _cashierCatalogAvailable = false;
        }
      }
      if (!mounted) return;
      _locations = (result['locations'] as List)
          .whereType<Map>()
          .map((row) => Map<String, dynamic>.from(row))
          .toList();
      final branch = '${result['selectedBranchId'] ?? ''}';
      widget.api.branchId = _locations.any((row) => '${row['id']}' == branch)
          ? branch
          : '';
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _chooseBranch() async {
    if (!await _canLeave() || !mounted) return;
    final selected = await staffChooseFields(
      context,
      staffText('Филиал', 'Филиал', 'Branch'),
      {
        '': staffText(
          'Все доступные филиалы',
          'Барлық қолжетімді филиалдар',
          'All accessible branches',
        ),
        for (final city in _locations.map((row) => '${row['city']}').toSet())
          'city:$city': '${staffText('Город', 'Қала', 'City')}: $city',
        for (final row in _locations)
          '${row['id']}': '${row['city']} · ${row['name']}',
      },
      [_selectedCity.isEmpty ? widget.api.branchId : 'city:$_selectedCity'],
      limit: 1,
    );
    if (selected != null && mounted) {
      setState(() {
        final value = selected.firstOrNull ?? '';
        _selectedCity = value.startsWith('city:') ? value.substring(5) : '';
        widget.api.branchId = _selectedCity.isEmpty ? value : '';
        widget.api.branchIds = _selectedCity.isEmpty
            ? []
            : _locations
                  .where((row) => row['city'] == _selectedCity)
                  .map((row) => '${row['id']}')
                  .toList();
      });
    }
  }

  Future<void> _logout() async {
    if (_signingOut || !await _canLeave() || !mounted) return;
    setState(() => _signingOut = true);
    try {
      await _push?.disable();
      if (_push?.enabled == true) {
        throw Exception(
          _push?.error ??
              staffText(
                'Не удалось отключить уведомления',
                'Хабарландыруларды өшіру мүмкін болмады',
                'Could not disable notifications',
              ),
        );
      }
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

  @override
  Widget build(BuildContext context) {
    final sections = _sections;
    if (!sections.containsKey(_section) && sections.isNotEmpty) {
      _section = sections.keys.first;
    }
    final branch = _locations
        .where((row) => '${row['id']}' == widget.api.branchId)
        .firstOrNull;
    return PopScope(
      canPop: _allowClose,
      onPopInvokedWithResult: (didPop, result) {
        if (!didPop) unawaited(_close());
      },
      child: Scaffold(
        backgroundColor: Colors.white,
        appBar: AppBar(
          toolbarHeight: BulkaLayout.appBarHeight(context),
          centerTitle: true,
          title: Text(
            sections[_section] ??
                staffText(
                  'Панель управления',
                  'Басқару панелі',
                  'Staff workspace',
                ),
            textAlign: TextAlign.center,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w600),
          ),
          actions: [
            if (_operationsAllowed)
              IconButton(
                tooltip: staffText('Поиск', 'Іздеу', 'Search'),
                onPressed: () => Navigator.push(
                  context,
                  StaffPageRoute<void>(
                    builder: (_) =>
                        StaffGlobalSearch(api: widget.api, role: _role),
                  ),
                ),
                icon: const Icon(Icons.search),
              ),
            if (_operationsAllowed)
              StaffAlerts(
                key: ValueKey('alerts:${widget.api.scopeKey}'),
                api: widget.api,
                navigate: (section) => unawaited(_navigate(section)),
              ),
            IconButton(
              tooltip: staffText('Закрыть', 'Жабу', 'Close'),
              onPressed: _close,
              icon: const Icon(Icons.close),
            ),
          ],
        ),
        drawer: Drawer(
          child: SafeArea(
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Padding(
                  padding: const EdgeInsets.all(16),
                  child: Image.asset('assets/brand/bulka_logo.png', height: 48),
                ),
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 18),
                  child: Text(
                    '${widget.user['username'] ?? ''}',
                    textAlign: TextAlign.center,
                  ),
                ),
                for (final section in sections.entries)
                  ListTile(
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(16),
                    ),
                    selected: _section == section.key,
                    selectedTileColor: const Color(0xFFFFF1CC),
                    leading: Icon(switch (section.key) {
                      'dashboard' => Icons.bar_chart_rounded,
                      'customers' => Icons.people_outline,
                      'operations' => Icons.space_dashboard_outlined,
                      'analytics' => Icons.insights,
                      'orders' => Icons.receipt_long_outlined,
                      'transactions' => Icons.swap_horiz,
                      'iiko' => Icons.storefront_outlined,
                      'couriers' => Icons.local_shipping_outlined,
                      'inventory' => Icons.inventory_2_outlined,
                      'support' => Icons.support_agent,
                      'reviews' => Icons.star_outline,
                      'stories' => Icons.auto_stories_outlined,
                      'news' => Icons.article_outlined,
                      'bonus' => Icons.card_giftcard,
                      'settings' => Icons.settings_outlined,
                      'access' => Icons.admin_panel_settings_outlined,
                      'locations' => Icons.location_on_outlined,
                      'menu' => Icons.restaurant_menu,
                      'dispatch' => Icons.delivery_dining,
                      'whatsapp' => Icons.chat_bubble_outline,
                      'marketing' => Icons.campaign_outlined,
                      'tiers' => Icons.loyalty_outlined,
                      'contacts' => Icons.contact_phone_outlined,
                      'broadcast' => Icons.notifications_active_outlined,
                      'taplink' => Icons.link_outlined,
                      'integrations' => Icons.hub_outlined,
                      'security' => Icons.security_outlined,
                      'site-access' => Icons.public_outlined,
                      _ => Icons.restaurant_outlined,
                    }),
                    title: Text(section.value),
                    onTap: () {
                      Navigator.pop(context);
                      unawaited(_navigate(section.key));
                    },
                  ),
                const Divider(height: 32),
                if (_push != null) StaffPushPanel(push: _push!),
                ListTile(
                  leading: const Icon(Icons.logout_rounded),
                  title: Text(
                    staffText(
                      'Выйти из аккаунта',
                      'Аккаунттан шығу',
                      'Sign out',
                    ),
                  ),
                  enabled: !_signingOut,
                  onTap: _logout,
                ),
              ],
            ),
          ),
        ),
        body: _loading
            ? const Center(child: CircularProgressIndicator())
            : _error != null
            ? _StaffError(message: _error!, onRetry: _scope)
            : Column(
                children: [
                  if (_role != 'whatsapp_operator' && _section != 'dashboard')
                    Padding(
                      padding: const EdgeInsets.fromLTRB(18, 6, 18, 12),
                      child: OutlinedButton(
                        onPressed: _chooseBranch,
                        style: OutlinedButton.styleFrom(
                          padding: const EdgeInsets.all(14),
                        ),
                        child: Row(
                          children: [
                            const Icon(Icons.storefront_outlined),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Text(
                                _selectedCity.isNotEmpty
                                    ? _selectedCity
                                    : branch == null
                                    ? staffText(
                                        'Все доступные филиалы',
                                        'Барлық қолжетімді филиалдар',
                                        'All accessible branches',
                                      )
                                    : '${branch['city']} · ${branch['name']}',
                                textAlign: TextAlign.center,
                              ),
                            ),
                            const SizedBox(width: 10),
                            const Icon(Icons.expand_more),
                          ],
                        ),
                      ),
                    ),
                  Expanded(
                    child: switch (_section) {
                      'menu' when _menuAllowed =>
                        _role == 'cashier'
                            ? StaffInventory(
                                api: widget.api,
                                role: _role,
                                key: ValueKey(
                                  'cashier-menu:${widget.api.scopeKey}',
                                ),
                              )
                            : StaffMenu(
                                api: widget.api,
                                role: _role,
                                key: ValueKey('menu:${widget.api.scopeKey}'),
                              ),
                      'dispatch' when _dashboardAllowed => StaffDispatch(
                        api: widget.api,
                        key: ValueKey('dispatch:${widget.api.scopeKey}'),
                      ),
                      'whatsapp' when _whatsappAllowed => StaffWhatsApp(
                        api: widget.api,
                        conversationOnly: _role == 'whatsapp_operator',
                        canEdit: _role != 'viewer',
                        key: ValueKey('whatsapp:${widget.api.scopeKey}'),
                      ),
                      'marketing' when _contentAllowed => StaffMarketing(
                        api: widget.api,
                        key: ValueKey('marketing:${widget.api.scopeKey}'),
                      ),
                      'tiers' when _contentAllowed => StaffContactsTiers(
                        api: widget.api,
                        tiers: true,
                        key: const ValueKey('tiers'),
                      ),
                      'contacts' when _contentAllowed => StaffContactsTiers(
                        api: widget.api,
                        key: const ValueKey('contacts'),
                      ),
                      'broadcast' when _contentAllowed => StaffBroadcast(
                        key: _broadcastKey,
                        api: widget.api,
                      ),
                      'taplink' when _contentAllowed => StaffTaplink(
                        key: _taplinkKey,
                        api: widget.api,
                      ),
                      'integrations' when _transactionsAllowed => StaffSystem(
                        api: widget.api,
                        section: 'integrations',
                        key: const ValueKey('integrations'),
                      ),
                      'security' when _dashboardAllowed => StaffSystem(
                        api: widget.api,
                        section: 'security',
                        key: const ValueKey('security'),
                      ),
                      'site-access' when _dashboardAllowed => StaffSiteAccess(
                        api: widget.api,
                      ),
                      'bonus' when _contentAllowed => StaffSettings(
                        key: ValueKey('bonus:${widget.api.scopeKey}'),
                        api: widget.api,
                        canEdit: true,
                        bonus: true,
                      ),
                      'settings' when _dashboardAllowed => StaffSettings(
                        key: ValueKey('settings:${widget.api.scopeKey}'),
                        api: widget.api,
                        canEdit: true,
                      ),
                      'access' when _dashboardAllowed => StaffAccess(
                        api: widget.api,
                        locations: _locations,
                        username: '${widget.user['username']}',
                      ),
                      'locations' when _transactionsAllowed => StaffLocations(
                        key: ValueKey('locations:${widget.api.scopeKey}'),
                        api: widget.api,
                        role: _role,
                      ),
                      'couriers' when _dashboardAllowed => StaffCouriers(
                        key: ValueKey('couriers:${widget.api.scopeKey}'),
                        api: widget.api,
                        canEdit: true,
                      ),
                      'inventory' => StaffInventory(
                        key: ValueKey('inventory:${widget.api.scopeKey}'),
                        api: widget.api,
                        role: _role,
                      ),
                      'support' when _operationsAllowed => StaffSupport(
                        key: ValueKey('support:${widget.api.scopeKey}'),
                        api: widget.api,
                        canEdit: _role != 'viewer',
                      ),
                      'reviews' when _dashboardAllowed => StaffSupport(
                        key: ValueKey('reviews:${widget.api.scopeKey}'),
                        api: widget.api,
                        canEdit: true,
                        reviews: true,
                      ),
                      'stories' when _contentAllowed => StaffContent(
                        key: ValueKey('stories:${widget.api.scopeKey}'),
                        api: widget.api,
                        stories: true,
                        canEdit: true,
                      ),
                      'news' when _contentAllowed => StaffContent(
                        key: ValueKey('news:${widget.api.scopeKey}'),
                        api: widget.api,
                        stories: false,
                        canEdit: true,
                      ),
                      'operations' when _operationsAllowed => StaffOverview(
                        key: ValueKey('operations:${widget.api.scopeKey}'),
                        api: widget.api,
                        role: _role,
                        analytics: false,
                        navigate: (section) {
                          if (_sections.containsKey(section)) {
                            setState(() => _section = section);
                          }
                        },
                      ),
                      'analytics' when _analyticsAllowed => StaffOverview(
                        key: ValueKey('analytics:${widget.api.scopeKey}'),
                        api: widget.api,
                        role: _role,
                        analytics: true,
                        navigate: (_) {},
                      ),
                      'orders' when _ordersAllowed => StaffOrders(
                        key: ValueKey('orders:${widget.api.scopeKey}'),
                        api: widget.api,
                        role: _role,
                      ),
                      'transactions' when _transactionsAllowed =>
                        StaffTransactions(
                          key: ValueKey('transactions:${widget.api.scopeKey}'),
                          api: widget.api,
                        ),
                      'iiko' when _dashboardAllowed => StaffTransactions(
                        key: ValueKey('iiko:${widget.api.scopeKey}'),
                        api: widget.api,
                        iiko: true,
                      ),
                      'customers' when _can('customers:read') => StaffCustomers(
                        key: ValueKey('customers:${widget.api.scopeKey}'),
                        api: widget.api,
                        actions: _actions,
                        role: _role,
                      ),
                      'kitchen' when _kitchenAllowed => StaffKitchen(
                        key: ValueKey('kitchen:${widget.api.scopeKey}'),
                        api: widget.api,
                        canEdit: _role != 'viewer',
                        canCancel: !['viewer', 'cashier'].contains(_role),
                      ),
                      'dashboard' when _dashboardAllowed => StaffDashboard(
                        key: ValueKey('dashboard:${widget.api.scopeKey}'),
                        api: widget.api,
                      ),
                      _ => Center(
                        child: Text(
                          staffText(
                            'Нет доступных разделов',
                            'Қолжетімді бөлімдер жоқ',
                            'No accessible sections',
                          ),
                        ),
                      ),
                    },
                  ),
                ],
              ),
      ),
    );
  }

  @override
  void dispose() {
    _push?.dispose();
    super.dispose();
  }
}
