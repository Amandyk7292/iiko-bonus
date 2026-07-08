part of '../main.dart';

class MainShell extends StatefulWidget {
  const MainShell({
    required this.api,
    required this.customer,
    required this.transactions,
    required this.onLogout,
    super.key,
  });

  final BulkaApiClient api;
  final Customer customer;
  final List<BonusTransaction> transactions;
  final Future<void> Function() onLogout;

  @override
  State<MainShell> createState() => _MainShellState();
}

class _MainShellState extends State<MainShell> {
  int _tab = 0;

  @override
  Widget build(BuildContext context) {
    final pages = [
      HomeScreen(
        api: widget.api,
        customer: widget.customer,
        transactions: widget.transactions,
        onHistoryTap: () => setState(() => _tab = 2),
        onProfileTap: () => setState(() => _tab = 4),
      ),
      const _ComingSoonScreen(
        title: 'Каталог',
        icon: Icons.bakery_dining_rounded,
        subtitle: 'Скоро здесь появятся любимые булочки, десерты и напитки.',
      ),
      OrdersScreen(transactions: widget.transactions),
      const _ComingSoonScreen(
        title: 'Акции',
        icon: Icons.card_giftcard_rounded,
        subtitle: 'Персональные предложения и сезонные акции будут здесь.',
      ),
      ProfileScreen(
        customer: widget.customer,
        onBack: () => setState(() => _tab = 0),
        onLogout: widget.onLogout,
      ),
    ];

    return Scaffold(
      body: IndexedStack(index: _tab, children: pages),
      bottomNavigationBar: FloatingNavBar(
        selectedIndex: _tab,
        onChanged: (index) => setState(() => _tab = index),
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
      _NavItem('Главная', Icons.home, Icons.home_outlined),
      _NavItem('Каталог', Icons.bakery_dining, Icons.bakery_dining_outlined),
      _NavItem('', Icons.shopping_bag, Icons.shopping_bag_outlined),
      _NavItem('Акции', Icons.card_giftcard, Icons.card_giftcard_outlined),
      _NavItem('Профиль', Icons.person, Icons.person_outline),
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
  });

  final _NavItem item;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final color = selected ? _cocoa : _textDark.withValues(alpha: 0.44);
    final isCenter = item.title.isEmpty;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(32),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
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
            AnimatedContainer(
              duration: const Duration(milliseconds: 180),
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
                          blurRadius: 22,
                          offset: const Offset(0, 10),
                        ),
                      ]
                    : null,
              ),
              child: Icon(
                selected ? item.selectedIcon : item.icon,
                color: isCenter ? Colors.white : color,
                size: isCenter ? 30 : 23,
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
    );
  }
}

class _ComingSoonScreen extends StatelessWidget {
  const _ComingSoonScreen({
    required this.title,
    required this.icon,
    required this.subtitle,
  });

  final String title;
  final IconData icon;
  final String subtitle;

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
            ],
          ),
        ),
      ),
    );
  }
}

class _NavItem {
  const _NavItem(this.title, this.selectedIcon, this.icon);

  final String title;
  final IconData selectedIcon;
  final IconData icon;
}
