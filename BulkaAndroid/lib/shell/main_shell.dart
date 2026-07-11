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

  void _changeTab(int index) {
    if (index == _tab) return;
    BulkaMotion.selection();
    setState(() => _tab = index);
  }

  @override
  Widget build(BuildContext context) {
    PushNotifications.listenForeground(context);
    final pages = [
      HomeScreen(
        key: const PageStorageKey('home-tab'),
        api: widget.api,
        customer: widget.customer,
        transactions: widget.transactions,
        onHistoryTap: () => _changeTab(2),
        onProfileTap: () => _changeTab(4),
      ),
      _HelpfulFeatureState(
        key: const PageStorageKey('catalog-tab'),
        title: 'nav_catalog'.tr,
        icon: Icons.bakery_dining_rounded,
        subtitle: 'catalog_sub'.tr,
        actionLabel: 'catalog_action'.tr,
        onAction: () => Navigator.of(context).push<void>(
          MaterialPageRoute(builder: (_) => const LocationsScreen()),
        ),
      ),
      OrdersScreen(
        key: const PageStorageKey('orders-tab'),
        transactions: widget.transactions,
        onExplore: () => _changeTab(0),
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

class _PersistentTabSwitcher extends StatelessWidget {
  const _PersistentTabSwitcher({required this.index, required this.children});

  final int index;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    // Do not fade five full-screen Scaffolds in a Stack. When a tab above the
    // new one (notably Profile) is put into TickerMode(false), its exit
    // animation stops before opacity reaches zero and it stays painted on top.
    // IndexedStack preserves every tab's state while making exactly one screen
    // visible and interactive.
    return IndexedStack(
      index: index,
      children: [
        for (var i = 0; i < children.length; i++)
          TickerMode(enabled: i == index, child: children[i]),
      ],
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
    final items = [
      _NavItem('nav_home'.tr, Icons.home, Icons.home_outlined),
      _NavItem(
        'nav_catalog'.tr,
        Icons.bakery_dining,
        Icons.bakery_dining_outlined,
      ),
      _NavItem(
        'orders_title'.tr,
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

    return SafeArea(
      minimum: const EdgeInsets.fromLTRB(0, 0, 0, 0),
      child: Container(
        height: 98,
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
          child: Padding(
            padding: const EdgeInsets.fromLTRB(10, 8, 10, 10),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (var i = 0; i < items.length; i++)
                  Expanded(
                    child: _NavButton(
                      key: ValueKey('nav-$i'),
                      item: items[i],
                      selected: i == selectedIndex,
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
    required this.onTap,
    super.key,
  });

  final _NavItem item;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final duration = BulkaMotion.duration(context, BulkaMotion.fast);
    final color = selected ? _cocoa : _textDark.withValues(alpha: 0.44);
    final isCenter = item.prominent;
    return Semantics(
      button: true,
      selected: selected,
      label: item.title,
      child: BulkaPressScale(
        pressedScale: 0.94,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(32),
          child: AnimatedContainer(
            duration: duration,
            curve: Curves.easeOutCubic,
            height: isCenter ? 72 : 66,
            padding: EdgeInsets.only(top: isCenter ? 0 : 7, bottom: 4),
            decoration: BoxDecoration(
              color: Colors.transparent,
              borderRadius: BorderRadius.circular(28),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                AnimatedScale(
                  scale: selected ? 1.06 : 1,
                  duration: duration,
                  curve: Curves.easeOutBack,
                  child: AnimatedContainer(
                    duration: duration,
                    width: isCenter ? 64 : 33,
                    height: isCenter ? 64 : 33,
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
                          ? [
                              BoxShadow(
                                color: _caramel.withValues(alpha: 0.25),
                                blurRadius: selected ? 26 : 18,
                                offset: Offset(0, selected ? 8 : 10),
                              ),
                            ]
                          : null,
                    ),
                    child: AnimatedSwitcher(
                      duration: duration,
                      switchInCurve: Curves.easeOutCubic,
                      switchOutCurve: Curves.easeInCubic,
                      child: Icon(
                        selected ? item.selectedIcon : item.icon,
                        key: ValueKey(selected),
                        color: isCenter ? Colors.white : color,
                        size: isCenter ? 30 : 23,
                      ),
                    ),
                  ),
                ),
                if (!isCenter) ...[
                  const SizedBox(height: 1),
                  Text(
                    item.title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: color,
                      fontSize: 10,
                      fontWeight: selected ? FontWeight.w900 : FontWeight.w500,
                    ),
                  ),
                ],
              ],
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
