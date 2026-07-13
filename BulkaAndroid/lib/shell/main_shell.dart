part of '../main.dart';

class MainShell extends StatefulWidget {
  const MainShell({
    required this.api,
    required this.customer,
    required this.transactions,
    required this.onLogout,
    required this.onRefreshProfile,
    super.key,
  });

  final BulkaApiClient api;
  final Customer customer;
  final List<BonusTransaction> transactions;
  final Future<void> Function() onLogout;
  final Future<void> Function() onRefreshProfile;

  @override
  State<MainShell> createState() => _MainShellState();
}

class _MainShellState extends State<MainShell> {
  int _tab = 0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) PushNotifications.listenForeground(context);
    });
  }

  void _changeTab(int index) {
    if (index == _tab) return;
    BulkaMotion.selection();
    setState(() => _tab = index);
  }

  @override
  Widget build(BuildContext context) {
    final pages = [
      HomeScreen(
        key: const PageStorageKey('home-tab'),
        api: widget.api,
        customer: widget.customer,
        transactions: widget.transactions,
        onHistoryTap: () => Navigator.of(context).push<void>(
          MaterialPageRoute(
            builder: (_) =>
                BalanceHistoryScreen(transactions: widget.transactions),
          ),
        ),
        onProfileTap: () => _changeTab(4),
      ),
      CatalogScreen(
        key: const PageStorageKey('catalog-tab'),
        onOpenCart: () => _changeTab(2),
      ),
      OrdersScreen(
        key: const PageStorageKey('orders-tab'),
        api: widget.api,
        customer: widget.customer,
        transactions: widget.transactions,
        onExplore: () => _changeTab(1),
      ),
      _HelpfulFeatureState(
        key: const PageStorageKey('promos-tab'),
        title: 'nav_promos'.tr,
        icon: Icons.card_giftcard_rounded,
        subtitle: 'promos_sub'.tr,
        actionLabel: 'promos_action'.tr,
        onAction: () => _changeTab(0),
      ),
      ProfileScreen(
        key: const PageStorageKey('profile-tab'),
        api: widget.api,
        customer: widget.customer,
        transactions: widget.transactions,
        onBack: () => _changeTab(0),
        onLogout: widget.onLogout,
        onRefreshProfile: widget.onRefreshProfile,
      ),
    ];

    return PopScope(
      canPop: _tab == 0,
      onPopInvokedWithResult: (didPop, result) {
        if (!didPop && _tab != 0) {
          _changeTab(0);
        }
      },
      child: Scaffold(
        extendBody: true,
        body: BulkaAdaptiveFrame(
          child: _PersistentTabSwitcher(index: _tab, children: pages),
        ),
        bottomNavigationBar: FloatingNavBar(
          selectedIndex: _tab,
          onChanged: _changeTab,
        ),
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
    final cartCount = context.select<CartProvider, int>(
      (cart) => cart.itemCount,
    );
    final items = [
      _NavItem('nav_home'.tr, Icons.home, Icons.home_outlined),
      _NavItem(
        'nav_catalog'.tr,
        Icons.bakery_dining,
        Icons.bakery_dining_outlined,
      ),
      _NavItem(
        'nav_cart'.tr,
        Icons.shopping_bag,
        Icons.shopping_bag_outlined,
        prominent: true,
      ),
      _NavItem(
        'nav_promos'.tr,
        Icons.card_giftcard,
        Icons.card_giftcard_outlined,
      ),
      _NavItem('nav_profile'.tr, Icons.person, Icons.person_outline),
    ];

    final safeBottom = BulkaLayout.safeBottomInset(context);
    return Container(
      height: BulkaLayout.floatingNavBarHeight + safeBottom,
      padding: EdgeInsets.only(bottom: safeBottom),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.98),
        boxShadow: [
          BoxShadow(
            color: _cocoa.withValues(alpha: 0.08),
            blurRadius: 24,
            offset: const Offset(0, -10),
          ),
        ],
      ),
      child: Material(
        color: Colors.transparent,
        child: BulkaAdaptiveFrame(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(
              BulkaLayout.floatingNavBarHorizontalPadding,
              BulkaLayout.floatingNavBarTopPadding,
              BulkaLayout.floatingNavBarHorizontalPadding,
              BulkaLayout.floatingNavBarBottomPadding,
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
                      onTap: () => onChanged(i),
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

class _NavButton extends StatelessWidget {
  const _NavButton({
    required this.item,
    required this.selected,
    required this.badgeCount,
    required this.onTap,
    super.key,
  });

  final _NavItem item;
  final bool selected;
  final int badgeCount;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final duration = BulkaMotion.duration(context, BulkaMotion.fast);
    final color = selected ? _textDark : _textDark.withValues(alpha: 0.44);
    final isCenter = item.prominent;
    final textScale = MediaQuery.textScalerOf(context).scale(1);
    final labelFontSize = textScale > 1.2 ? 9.0 : 10.0;
    return Semantics(
      button: true,
      selected: selected,
      label: item.title,
      child: BulkaPressScale(
        pressedScale: 0.97,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(32),
          child: SizedBox(
            height: BulkaLayout.navItemHeight,
            child: Padding(
              padding: EdgeInsets.only(top: isCenter ? 0 : 7, bottom: 4),
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
                          ? BulkaLayout.centerNavIconSize
                          : BulkaLayout.navIconSize,
                      height: isCenter
                          ? BulkaLayout.centerNavIconSize
                          : BulkaLayout.navIconSize,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        gradient: isCenter
                            ? const LinearGradient(
                                begin: Alignment.topLeft,
                                end: Alignment.bottomRight,
                                colors: [Color(0xFFFFD54F), Color(0xFFFFB300)],
                              )
                            : null,
                        color: isCenter
                            ? null
                            : selected
                            ? _almond.withValues(alpha: 0.62)
                            : Colors.transparent,
                        boxShadow: isCenter
                            ? const [
                                BoxShadow(
                                  color: Color(0x40FFB814),
                                  blurRadius: 20,
                                  offset: Offset(0, 9),
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
                            child: Icon(
                              selected ? item.selectedIcon : item.icon,
                              key: ValueKey(selected),
                              color: isCenter ? Colors.white : color,
                              size: isCenter ? 26 : 23,
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
                                  borderRadius: BorderRadius.circular(10),
                                  border: Border.all(
                                    color: Colors.white,
                                    width: 2,
                                  ),
                                ),
                                child: Text(
                                  badgeCount > 99 ? '99+' : '$badgeCount',
                                  style: const TextStyle(
                                    color: Colors.white,
                                    fontSize: 10,
                                    height: 1,
                                    fontWeight: FontWeight.w800,
                                  ),
                                ),
                              ),
                            ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 1),
                  AnimatedDefaultTextStyle(
                    duration: duration,
                    curve: BulkaMotion.standardCurve,
                    style: TextStyle(
                      color: color,
                      fontSize: labelFontSize,
                      height: 1.05,
                      fontWeight: selected ? FontWeight.w900 : FontWeight.w500,
                    ),
                    child: Text(
                      item.title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
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

class _HelpfulFeatureState extends StatelessWidget {
  const _HelpfulFeatureState({
    required this.title,
    required this.icon,
    required this.subtitle,
    required this.actionLabel,
    required this.onAction,
    super.key,
  });

  final String title;
  final IconData icon;
  final String subtitle;
  final String actionLabel;
  final VoidCallback onAction;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(title: Text(title)),
      body: Center(
        child: Container(
          margin: const EdgeInsets.all(24),
          padding: const EdgeInsets.all(24),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(28),
            boxShadow: [
              BoxShadow(
                color: _cocoa.withValues(alpha: 0.07),
                blurRadius: 28,
                offset: const Offset(0, 14),
              ),
            ],
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, color: _caramel, size: 42),
              const SizedBox(height: 14),
              Text(
                title,
                style: const TextStyle(
                  color: _textDark,
                  fontFamily: _headingFont,
                  fontSize: 22,
                  fontWeight: FontWeight.w400,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                subtitle,
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: _textDark.withValues(alpha: 0.62),
                  fontSize: 15,
                  height: 1.4,
                ),
              ),
              const SizedBox(height: 20),
              SizedBox(
                width: double.infinity,
                child: GradientButton(
                  onPressed: onAction,
                  child: Text(actionLabel),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _NavItem {
  const _NavItem(
    this.title,
    this.selectedIcon,
    this.icon, {
    this.prominent = false,
  });

  final String title;
  final IconData selectedIcon;
  final IconData icon;
  final bool prominent;
}
