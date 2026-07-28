part of '../main.dart';

class MainShell extends StatefulWidget {
  const MainShell({
    required this.api,
    required this.customer,
    required this.transactions,
    required this.onLogout,
    required this.onRefreshProfile,
    this.onRequireAuth,
    this.initialTab = 0,
    this.onTabChanged,
    this.onOpenOrders,
    super.key,
  });

  final BulkaApiClient api;
  final Customer? customer;
  final List<BonusTransaction> transactions;
  final Future<void> Function() onLogout;
  final Future<void> Function() onRefreshProfile;
  final Future<bool> Function()? onRequireAuth;
  final int initialTab;
  final ValueChanged<int>? onTabChanged;
  final Future<void> Function()? onOpenOrders;

  @override
  State<MainShell> createState() => _MainShellState();
}

class _MainShellState extends State<MainShell> {
  final GlobalKey<_CatalogScreenState> _catalogKey = GlobalKey(
    debugLabel: 'catalog-tab',
  );
  late int _tab;
  String _catalogOrderType = 'pickup';
  int _catalogSelectionRevision = 0;
  bool _hasCatalogOrderType = false;
  bool _authFlowInProgress = false;
  final _navigationGate = _AsyncActionGate();

  static int? _tabForClientUri(Uri uri) {
    final segments = uri.pathSegments
        .where((value) => value.isNotEmpty)
        .toList();
    if (segments.isEmpty) return 0;
    return switch (segments.first) {
      'catalog' => 1,
      'cart' => 2,
      'promos' => 3,
      'profile' => 4,
      _ => null,
    };
  }

  static Uri _uriForTab(int index) {
    return switch (index) {
      1 => Uri(path: '/catalog'),
      2 => Uri(path: '/cart'),
      3 => Uri(path: '/promos'),
      4 => Uri(path: '/profile'),
      _ => Uri(path: '/'),
    };
  }

  @override
  void initState() {
    super.initState();
    _tab =
        (kIsWeb
            ? _tabForClientUri(clientRouteNotifier.value)
            : widget.initialTab) ??
        widget.initialTab;
    _tab = _tab.clamp(0, 4).toInt();
    clientRouteNotifier.addListener(_onClientRouteChanged);
    unawaited(_restoreCatalogOrderType());
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _catalogKey.currentState?.applyClientUri(clientRouteNotifier.value);
      if (mounted && widget.api.isAuthenticated) {
        PushNotifications.listenForeground(context);
      }
    });
  }

  @override
  void didUpdateWidget(covariant MainShell oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.initialTab != widget.initialTab &&
        _tab != widget.initialTab) {
      _tab = widget.initialTab.clamp(0, 4).toInt();
    }
  }

  @override
  void dispose() {
    clientRouteNotifier.removeListener(_onClientRouteChanged);
    super.dispose();
  }

  void _onClientRouteChanged() {
    if (!mounted) return;
    final uri = clientRouteNotifier.value;
    final routedTab = _tabForClientUri(uri);
    if (routedTab != null && routedTab != _tab) {
      setState(() => _tab = routedTab);
      widget.onTabChanged?.call(routedTab);
    }
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _catalogKey.currentState?.applyClientUri(uri);
    });
  }

  Future<bool> _requireAuth() async {
    if (widget.customer != null && widget.api.isAuthenticated) return true;
    if (_authFlowInProgress) return false;
    _authFlowInProgress = true;
    try {
      return await widget.onRequireAuth?.call() ?? false;
    } finally {
      _authFlowInProgress = false;
    }
  }

  Future<void> _openBalanceHistory() async {
    await _navigationGate.run(() async {
      await Navigator.of(context).push<void>(
        MaterialPageRoute(
          builder: (_) =>
              BalanceHistoryScreen(transactions: widget.transactions),
        ),
      );
    });
  }

  Future<void> _restoreCatalogOrderType() async {
    final prefs = await SharedPreferences.getInstance();
    final savedOrderType = prefs.getString('selected_order_type')?.trim() ?? '';
    final restored = _orderTypeFromWire(savedOrderType).wireValue;
    if (mounted && _catalogSelectionRevision == 0) {
      setState(() {
        _catalogOrderType = restored;
        _hasCatalogOrderType = savedOrderType.isNotEmpty;
      });
    }
  }

  Future<void> _openCatalogFor(String orderType) async {
    final normalized = _orderTypeFromWire(orderType).wireValue;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('selected_order_type', normalized);
    if (!mounted) return;
    setState(() {
      _catalogOrderType = normalized;
      _hasCatalogOrderType = true;
      _catalogSelectionRevision++;
    });
    _changeTab(1);
  }

  void _changeTab(int index) {
    if (index == _tab) {
      if (index == 1) {
        _catalogKey.currentState?.closeCategoryPage();
      } else {
        publishClientRoute(_uriForTab(index), replace: true);
      }
      return;
    }
    BulkaMotion.selection();
    setState(() => _tab = index);
    publishClientRoute(_uriForTab(index));
    widget.onTabChanged?.call(index);
  }

  @override
  Widget build(BuildContext context) {
    final customer = widget.customer;
    final pages = [
      HomeScreen(
        key: const PageStorageKey('home-tab'),
        api: widget.api,
        customer: customer,
        transactions: widget.transactions,
        onHistoryTap: customer == null
            ? () => unawaited(_requireAuth())
            : _openBalanceHistory,
        onProfileTap: () => _changeTab(4),
        onRequireAuth: _requireAuth,
        onOpenCatalog: _openCatalogFor,
        onOpenNotificationTab: _changeTab,
      ),
      CatalogScreen(
        key: _catalogKey,
        api: widget.api,
        orderType: _catalogOrderType,
        hasSelectedOrderType: _hasCatalogOrderType,
        selectionRevision: _catalogSelectionRevision,
        onRequestOrderType: () => _changeTab(0),
        initialClientUri: clientRouteNotifier.value,
      ),
      OrdersScreen(
        key: const PageStorageKey('orders-tab'),
        api: widget.api,
        customer: customer,
        transactions: widget.transactions,
        onExplore: () => _changeTab(1),
        onRequireAuth: _requireAuth,
      ),
      PromosScreen(key: const PageStorageKey('promos-tab'), api: widget.api),
      if (customer == null)
        _GuestProfileScreen(
          key: const PageStorageKey('guest-profile-tab'),
          onSignIn: _requireAuth,
        )
      else
        ProfileScreen(
          key: const PageStorageKey('profile-tab'),
          api: widget.api,
          customer: customer,
          transactions: widget.transactions,
          onBack: () => _changeTab(0),
          onLogout: widget.onLogout,
          onRefreshProfile: widget.onRefreshProfile,
          onOpenOrders: widget.onOpenOrders ?? () async {},
        ),
    ];

    final tabSwitcher = _PersistentTabSwitcher(index: _tab, children: pages);
    return PopScope(
      canPop: _tab == 0,
      onPopInvokedWithResult: (didPop, result) {
        if (!didPop && _tab != 0) {
          if (_tab == 1 &&
              (_catalogKey.currentState?.closeCategoryPage() ?? false)) {
            return;
          }
          _changeTab(0);
        }
      },
      child: LayoutBuilder(
        builder: (context, constraints) {
          final useDesktopNavigation = constraints.maxWidth >= 900;
          if (useDesktopNavigation) {
            return Scaffold(
              backgroundColor: Theme.of(context).colorScheme.surface,
              body: Align(
                alignment: Alignment.topCenter,
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 1360),
                  child: Row(
                    children: [
                      _DesktopNavigation(
                        selectedIndex: _tab,
                        onChanged: _changeTab,
                      ),
                      Expanded(child: tabSwitcher),
                    ],
                  ),
                ),
              ),
            );
          }
          return Scaffold(
            extendBody: true,
            body: BulkaAdaptiveFrame(child: tabSwitcher),
            bottomNavigationBar: FloatingNavBar(
              selectedIndex: _tab,
              onChanged: _changeTab,
            ),
          );
        },
      ),
    );
  }
}

class _PersistentTabSwitcher extends StatefulWidget {
  const _PersistentTabSwitcher({required this.index, required this.children});

  final int index;
  final List<Widget> children;

  @override
  State<_PersistentTabSwitcher> createState() => _PersistentTabSwitcherState();
}

class _PersistentTabSwitcherState extends State<_PersistentTabSwitcher> {
  late final Set<int> _visited = {widget.index};

  @override
  void didUpdateWidget(covariant _PersistentTabSwitcher oldWidget) {
    super.didUpdateWidget(oldWidget);
    _visited.add(widget.index);
  }

  @override
  Widget build(BuildContext context) {
    // iOS tabs switch immediately. Keeping the transition on the small nav
    // controls avoids compositing two full-screen CanvasKit/SkWasm surfaces on
    // every frame, which is a common source of scroll and tap jank on Safari.
    return Stack(
      fit: StackFit.expand,
      children: [
        for (var i = 0; i < widget.children.length; i++)
          if (_visited.contains(i)) _buildTabSlot(i),
      ],
    );
  }

  Widget _buildTabSlot(int slotIndex) {
    final visible = slotIndex == widget.index;
    return Offstage(
      key: ValueKey('tab-slot-$slotIndex'),
      offstage: !visible,
      child: TickerMode(
        enabled: visible,
        child: ExcludeSemantics(
          excluding: !visible,
          child: ExcludeFocus(
            excluding: !visible,
            child: IgnorePointer(
              ignoring: !visible,
              child: RepaintBoundary(child: widget.children[slotIndex]),
            ),
          ),
        ),
      ),
    );
  }
}

class FloatingNavBar extends StatelessWidget {
  const FloatingNavBar({
    required this.selectedIndex,
    required this.onChanged,
    super.key,
  });

  final int selectedIndex;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final cartCount = context.select<CartProvider, int>(
      (cart) => cart.itemCount,
    );
    final items = [
      _NavItem('nav_home'.tr, BulkaNavIconKind.home),
      _NavItem('nav_catalog'.tr, BulkaNavIconKind.catalog),
      _NavItem('nav_cart'.tr, BulkaNavIconKind.cart, prominent: true),
      _NavItem('nav_promos'.tr, BulkaNavIconKind.promos),
      _NavItem('nav_profile'.tr, BulkaNavIconKind.profile),
    ];

    final safeBottom = BulkaLayout.safeBottomInset(context);
    final compact = BulkaLayout.compactNavigation(context);
    final narrow = MediaQuery.sizeOf(context).width < 360;
    final highContrast = MediaQuery.highContrastOf(context);
    final useBlur = !kIsWeb && !highContrast;
    final bar = Container(
      height: BulkaLayout.navigationBarHeight(context) + safeBottom,
      padding: EdgeInsets.only(bottom: safeBottom),
      decoration: BoxDecoration(
        color: scheme.surface.withValues(alpha: useBlur ? 0.84 : 1),
        border: Border(
          top: BorderSide(
            color: highContrast
                ? context.bulkaColors.cardBorder
                : Colors.white.withValues(alpha: 0.72),
          ),
        ),
        boxShadow: [
          BoxShadow(
            color: _cocoa.withValues(alpha: 0.075),
            blurRadius: 28,
            offset: const Offset(0, -8),
          ),
        ],
      ),
      child: Material(
        color: Colors.transparent,
        child: BulkaAdaptiveFrame(
          child: Padding(
            padding: EdgeInsets.fromLTRB(
              BulkaLayout.floatingNavBarHorizontalPadding,
              compact ? 3 : BulkaLayout.floatingNavBarTopPadding,
              BulkaLayout.floatingNavBarHorizontalPadding,
              compact ? 3 : BulkaLayout.floatingNavBarBottomPadding,
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (var i = 0; i < items.length; i++)
                  Expanded(
                    child: _NavButton(
                      key: ValueKey('nav-$i'),
                      item: items[i],
                      selected: i == selectedIndex,
                      badgeCount: i == 2 ? cartCount : 0,
                      compact: compact,
                      narrow: narrow,
                      onTap: () => onChanged(i),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
    if (!useBlur) return bar;
    return ClipRect(
      child: BackdropFilter(
        filter: ui.ImageFilter.blur(sigmaX: 20, sigmaY: 20),
        child: bar,
      ),
    );
  }
}

class _NavButton extends StatelessWidget {
  const _NavButton({
    required this.item,
    required this.selected,
    required this.badgeCount,
    required this.compact,
    required this.narrow,
    required this.onTap,
    super.key,
  });

  final _NavItem item;
  final bool selected;
  final int badgeCount;
  final bool compact;
  final bool narrow;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final duration = BulkaMotion.duration(context, BulkaMotion.fast);
    final colors = context.bulkaColors;
    final color = selected ? colors.brandBrown : colors.mutedText;
    final isCenter = item.prominent;
    final centerIdle = isCenter && !selected;
    final labelFontSize = BulkaTypeScale.caption;
    return Semantics(
      button: true,
      selected: selected,
      label: item.title,
      child: BulkaPressScale(
        pressedScale: 0.97,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(BulkaRadii.sheet),
          child: SizedBox(
            height: compact
                ? BulkaLayout.compactNavItemHeight
                : BulkaLayout.navItemHeight,
            child: Padding(
              padding: EdgeInsets.only(
                top: isCenter ? 0 : (compact ? 3 : 4),
                bottom: 2,
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  AnimatedScale(
                    scale: selected ? 1.035 : 1,
                    duration: duration,
                    curve: BulkaMotion.enterCurve,
                    child: AnimatedContainer(
                      duration: duration,
                      curve: BulkaMotion.standardCurve,
                      width: isCenter
                          ? (compact
                                ? 40
                                : narrow
                                ? 40
                                : BulkaLayout.centerNavIconSize)
                          : (compact
                                ? 38
                                : narrow
                                ? 38
                                : 44),
                      height: isCenter
                          ? (compact
                                ? 40
                                : narrow
                                ? 40
                                : BulkaLayout.centerNavIconSize)
                          : (compact
                                ? 38
                                : narrow
                                ? 38
                                : 44),
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        gradient: selected
                            ? const LinearGradient(
                                begin: Alignment.topLeft,
                                end: Alignment.bottomRight,
                                colors: [Color(0xFFFFDB70), Color(0xFFFFB300)],
                              )
                            : null,
                        color: centerIdle
                            ? colors.brandGold.withValues(alpha: 0.16)
                            : Colors.transparent,
                        border: centerIdle
                            ? Border.all(
                                color: colors.brandGold.withValues(alpha: 0.58),
                              )
                            : null,
                        boxShadow: selected
                            ? const [
                                BoxShadow(
                                  color: Color(0x35FFB814),
                                  blurRadius: 16,
                                  offset: Offset(0, 7),
                                ),
                              ]
                            : null,
                      ),
                      child: Stack(
                        clipBehavior: Clip.none,
                        alignment: Alignment.center,
                        children: [
                          AnimatedSwitcher(
                            duration: duration,
                            switchInCurve: BulkaMotion.enterCurve,
                            switchOutCurve: BulkaMotion.exitCurve,
                            transitionBuilder: (child, animation) =>
                                FadeTransition(
                                  opacity: animation,
                                  child: ScaleTransition(
                                    scale: Tween<double>(
                                      begin: 0.88,
                                      end: 1,
                                    ).animate(animation),
                                    child: child,
                                  ),
                                ),
                            child: BulkaNavIcon(
                              key: ValueKey('${item.kind.name}-$selected'),
                              kind: item.kind,
                              active: selected,
                              color: color,
                              size: isCenter
                                  ? (compact
                                        ? 23
                                        : narrow
                                        ? 23
                                        : 27)
                                  : (compact
                                        ? 21
                                        : narrow
                                        ? 21
                                        : 25),
                            ),
                          ),
                          if (badgeCount > 0)
                            Positioned(
                              top: -5,
                              right: -5,
                              child: Container(
                                constraints: const BoxConstraints(
                                  minWidth: 19,
                                  minHeight: 19,
                                ),
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 5,
                                ),
                                alignment: Alignment.center,
                                decoration: BoxDecoration(
                                  color: _errorRed,
                                  borderRadius: BorderRadius.circular(
                                    BulkaRadii.small,
                                  ),
                                  border: Border.all(
                                    color: Theme.of(
                                      context,
                                    ).colorScheme.surface,
                                    width: 2,
                                  ),
                                ),
                                child: Text(
                                  badgeCount > 99 ? '99+' : '$badgeCount',
                                  style: const TextStyle(
                                    fontFamily: _headingFont,
                                    color: Colors.white,
                                    fontSize: BulkaTypeScale.badge,
                                    height: 1,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                              ),
                            ),
                        ],
                      ),
                    ),
                  ),
                  SizedBox(height: narrow ? 2 : 1),
                  Expanded(
                    child: AnimatedDefaultTextStyle(
                      duration: duration,
                      curve: BulkaMotion.standardCurve,
                      style: TextStyle(
                        fontFamily: _descriptionFont,
                        color: color,
                        fontSize: labelFontSize,
                        height: narrow ? 1.05 : 1.15,
                        fontWeight: selected
                            ? FontWeight.w700
                            : FontWeight.w500,
                      ),
                      child: Text(
                        item.title,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        textAlign: TextAlign.center,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _DesktopNavigation extends StatelessWidget {
  const _DesktopNavigation({
    required this.selectedIndex,
    required this.onChanged,
  });

  final int selectedIndex;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    final cartCount = context.select<CartProvider, int>(
      (cart) => cart.itemCount,
    );
    final items = [
      _NavItem('nav_home'.tr, BulkaNavIconKind.home),
      _NavItem('nav_catalog'.tr, BulkaNavIconKind.catalog),
      _NavItem('nav_cart'.tr, BulkaNavIconKind.cart),
      _NavItem('nav_promos'.tr, BulkaNavIconKind.promos),
      _NavItem('nav_profile'.tr, BulkaNavIconKind.profile),
    ];

    Widget iconFor(_NavItem item, int index, bool active) {
      final icon = BulkaNavIcon(
        kind: item.kind,
        active: active,
        color: active ? colors.brandBrown : colors.mutedText,
        size: 25,
      );
      if (index != 2 || cartCount <= 0) return icon;
      return Badge(
        label: Text(cartCount > 99 ? '99+' : '$cartCount'),
        backgroundColor: colors.danger,
        child: icon,
      );
    }

    return SafeArea(
      right: false,
      child: Material(
        color: Theme.of(context).colorScheme.surface,
        child: Container(
          width: 118,
          decoration: BoxDecoration(
            border: Border(right: BorderSide(color: colors.cardBorder)),
          ),
          child: NavigationRail(
            selectedIndex: selectedIndex,
            onDestinationSelected: onChanged,
            backgroundColor: Colors.transparent,
            indicatorColor: colors.brandGold,
            labelType: NavigationRailLabelType.all,
            groupAlignment: -0.25,
            leading: Padding(
              padding: const EdgeInsets.fromLTRB(12, 24, 12, 20),
              child: Image.asset(
                'assets/brand/bulka_logo.png',
                width: 86,
                fit: BoxFit.contain,
                excludeFromSemantics: true,
              ),
            ),
            destinations: [
              for (var index = 0; index < items.length; index++)
                NavigationRailDestination(
                  icon: iconFor(items[index], index, false),
                  selectedIcon: iconFor(items[index], index, true),
                  label: Text(
                    items[index].title,
                    textAlign: TextAlign.center,
                    maxLines: 2,
                  ),
                  padding: const EdgeInsets.symmetric(vertical: 5),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _NavItem {
  const _NavItem(this.title, this.kind, {this.prominent = false});

  final String title;
  final BulkaNavIconKind kind;
  final bool prominent;
}

class _GuestProfileScreen extends StatelessWidget {
  const _GuestProfileScreen({required this.onSignIn, super.key});

  final Future<bool> Function() onSignIn;

  Future<void> _selectLanguage(BuildContext context) async {
    final code = await showLanguageBottomSheet(
      context,
      initialCode: AppLang.current,
    );
    if (code != null) await AppLang.setLanguage(code);
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      backgroundColor: scheme.surface,
      body: SafeArea(
        bottom: false,
        child: ListView(
          padding: EdgeInsets.fromLTRB(
            20,
            18,
            20,
            BulkaLayout.bottomNavContentInset(context),
          ),
          children: [
            Text(
              'guest_profile_title'.tr,
              style: const TextStyle(
                fontFamily: _headingFont,
                fontSize: BulkaTypeScale.pageTitle,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 20),
            Semantics(
              container: true,
              label:
                  '${'guest_profile_heading'.tr}. ${'guest_profile_body'.tr}',
              child: Container(
                padding: const EdgeInsets.all(22),
                decoration: BoxDecoration(
                  color: colors.surfaceCream,
                  borderRadius: BorderRadius.circular(BulkaRadii.card),
                  border: Border.all(color: colors.cardBorder),
                ),
                child: Column(
                  children: [
                    Container(
                      width: 72,
                      height: 72,
                      decoration: BoxDecoration(
                        color: colors.brandGold.withValues(alpha: 0.18),
                        shape: BoxShape.circle,
                      ),
                      child: Icon(
                        Icons.person_outline_rounded,
                        size: 38,
                        color: colors.brandBrown,
                      ),
                    ),
                    const SizedBox(height: 16),
                    Text(
                      'guest_profile_heading'.tr,
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        fontFamily: _headingFont,
                        fontSize: BulkaTypeScale.title,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'guest_profile_body'.tr,
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: colors.mutedText,
                        fontSize: BulkaTypeScale.body,
                        height: 1.4,
                      ),
                    ),
                    const SizedBox(height: 20),
                    SizedBox(
                      width: double.infinity,
                      child: FilledButton.icon(
                        onPressed: () => unawaited(onSignIn()),
                        icon: const Icon(Icons.login_rounded),
                        label: Text('guest_sign_in'.tr),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 20),
            Container(
              decoration: BoxDecoration(
                color: colors.surfaceCream,
                borderRadius: BorderRadius.circular(BulkaRadii.card),
                border: Border.all(color: colors.cardBorder),
              ),
              child: Column(
                children: [
                  _ProfileMenuItem(
                    icon: Icons.language_rounded,
                    title: 'select_lang_title'.tr,
                    onTap: () => _selectLanguage(context),
                  ),
                  Divider(height: 1, indent: 60, color: colors.cardBorder),
                  _ProfileMenuItem(
                    icon: Icons.location_on_outlined,
                    title: 'locations_title'.tr,
                    onTap: () => Navigator.of(context).push<void>(
                      MaterialPageRoute(
                        builder: (_) => const LocationsScreen(),
                      ),
                    ),
                  ),
                  Divider(height: 1, indent: 60, color: colors.cardBorder),
                  _ProfileMenuItem(
                    icon: Icons.mail_outline_rounded,
                    title: 'menu_contact'.tr,
                    onTap: () => _openTelegram(context),
                  ),
                  Divider(height: 1, indent: 60, color: colors.cardBorder),
                  _ProfileMenuItem(
                    icon: Icons.account_balance_outlined,
                    title: 'legal_documents_title'.tr,
                    onTap: () => Navigator.of(context).push<void>(
                      MaterialPageRoute(
                        builder: (_) => const LegalDocumentsScreen(),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
