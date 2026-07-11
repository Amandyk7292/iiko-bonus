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
            builder: (_) => BalanceHistoryScreen(
              transactions: widget.transactions,
            ),
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

class _PersistentTabSwitcherState extends State<_PersistentTabSwitcher>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  late int _fromIndex;
  int _direction = 1;
  bool _reduceMotion = false;

  @override
  void initState() {
    super.initState();
    _fromIndex = widget.index;
    _controller = AnimationController(
      vsync: this,
      duration: BulkaMotion.emphasized,
      value: 1,
    );
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final reduceMotion = BulkaMotion.reduced(context);
    if (_reduceMotion == reduceMotion) return;
    _reduceMotion = reduceMotion;
    _controller.duration = reduceMotion
        ? Duration.zero
        : BulkaMotion.emphasized;
    if (reduceMotion) {
      _controller
        ..stop()
        ..value = 1;
    }
  }

  @override
  void didUpdateWidget(covariant _PersistentTabSwitcher oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.index == oldWidget.index) return;
    _fromIndex = oldWidget.index;
    _direction = widget.index > oldWidget.index ? 1 : -1;
    if (_reduceMotion) {
      _controller.value = 1;
    } else {
      _controller.forward(from: 0);
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, _) {
        final rawProgress = _reduceMotion ? 1.0 : _controller.value;
        final progress = BulkaMotion.enterCurve.transform(rawProgress);
        final transitioning = rawProgress < 1 && _fromIndex != widget.index;
        final paintOrder = [
          for (var i = 0; i < widget.children.length; i++)
            if (i != widget.index) i,
          widget.index,
        ];

        return Stack(
          fit: StackFit.expand,
          children: [
            // Paint the incoming page last. This keeps the outgoing page as a
            // stable backdrop and avoids animating opacity on two full screens.
            for (final i in paintOrder)
              _buildTabSlot(i, progress, transitioning),
          ],
        );
      },
    );
  }

  Widget _buildTabSlot(int index, double progress, bool transitioning) {
    final incoming = index == widget.index;
    final outgoing = transitioning && index == _fromIndex;
    final visible = incoming || outgoing;

    var opacity = 1.0;
    var dx = 0.0;
    var scale = 1.0;
    if (transitioning && incoming) {
      opacity = 0.88 + (0.12 * progress);
      dx = _direction * 12 * (1 - progress);
      scale = 0.992 + (0.008 * progress);
    } else if (outgoing) {
      dx = -_direction * 6 * progress;
      scale = 1 - (0.004 * progress);
    }

    return Offstage(
      key: ValueKey('tab-slot-$index'),
      offstage: !visible,
      child: TickerMode(
        enabled: visible,
        child: ExcludeSemantics(
          excluding: !incoming,
          child: ExcludeFocus(
            excluding: !incoming,
            child: IgnorePointer(
              ignoring: !incoming,
              child: Opacity(
                opacity: opacity.clamp(0, 1),
                child: Transform.translate(
                  offset: Offset(dx, 0),
                  child: Transform.scale(
                    scale: scale,
                    child: RepaintBoundary(child: widget.children[index]),
                  ),
                ),
              ),
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
        pressedScale: 0.97,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(32),
          child: SizedBox(
            height: isCenter ? 72 : 66,
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
                            ? const [
                                BoxShadow(
                                  color: Color(0x40C66A25),
                                  blurRadius: 20,
                                  offset: Offset(0, 9),
                                ),
                              ]
                            : null,
                      ),
                      child: AnimatedSwitcher(
                        duration: duration,
                        switchInCurve: BulkaMotion.enterCurve,
                        switchOutCurve: BulkaMotion.exitCurve,
                        transitionBuilder: (child, animation) => FadeTransition(
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
                          size: isCenter ? 30 : 23,
                        ),
                      ),
                    ),
                  ),
                  if (!isCenter) ...[
                    const SizedBox(height: 1),
                    AnimatedDefaultTextStyle(
                      duration: duration,
                      curve: BulkaMotion.standardCurve,
                      style: TextStyle(
                        color: color,
                        fontSize: 10,
                        fontWeight: selected
                            ? FontWeight.w900
                            : FontWeight.w500,
                      ),
                      child: Text(
                        item.title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
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
