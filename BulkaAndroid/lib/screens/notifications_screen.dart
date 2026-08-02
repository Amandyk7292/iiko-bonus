part of '../main.dart';

class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({
    required this.api,
    this.onRequireAuth,
    this.onOpenTab,
    super.key,
  });

  final BulkaApiClient api;
  final Future<bool> Function()? onRequireAuth;
  final ValueChanged<int>? onOpenTab;

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  late final ContactCenterRepository _contactsRepository;
  late Future<List<AppContactCard>> _contactsFuture;
  Future<List<AppNotification>>? _notificationsFuture;
  int _selectedTab = 0;

  bool get _isAuthenticated => widget.api.isAuthenticated;

  @override
  void initState() {
    super.initState();
    _contactsRepository = ContactCenterRepository(api: widget.api);
    _contactsFuture = _contactsRepository.load();
    if (_isAuthenticated) {
      _notificationsFuture = widget.api.getNotifications();
    }
  }

  Future<void> _reloadNotifications() async {
    if (!_isAuthenticated) return;
    final future = widget.api.getNotifications();
    setState(() => _notificationsFuture = future);
    await future;
  }

  Future<void> _reloadContacts() async {
    final future = _contactsRepository.load();
    setState(() => _contactsFuture = future);
    await future;
  }

  Future<void> _requestAuthentication() async {
    final authenticated = await widget.onRequireAuth?.call() ?? false;
    if (!mounted || !authenticated) return;
    setState(() => _notificationsFuture = widget.api.getNotifications());
  }

  void _selectTab(int index) {
    if (_selectedTab == index) return;
    BulkaMotion.selection();
    setState(() => _selectedTab = index);
  }

  Future<void> _markAllRead() async {
    try {
      await widget.api.markAllNotificationsRead();
      await _reloadNotifications();
    } catch (error) {
      if (mounted) _showError(localizeErrorMessage(error));
    }
  }

  Future<void> _openNotification(AppNotification notification) async {
    if (!notification.isRead) {
      try {
        await widget.api.markNotificationRead(notification.id);
      } catch (_) {}
    }

    final target = resolveNotificationTarget(notification);
    if (!mounted) return;
    switch (target.kind) {
      case NotificationTargetKind.orders:
        if (widget.onOpenTab != null) {
          Navigator.of(context).pop();
          widget.onOpenTab!(2);
        } else {
          await _reloadNotifications();
        }
      case NotificationTargetKind.promos:
        if (widget.onOpenTab != null) {
          Navigator.of(context).pop();
          widget.onOpenTab!(3);
        } else {
          await Navigator.of(context).push<void>(
            MaterialPageRoute(builder: (_) => PromosScreen(api: widget.api)),
          );
        }
      case NotificationTargetKind.support:
        await Navigator.of(context).push<void>(
          MaterialPageRoute(
            builder: (_) => OrderSupportScreen(api: widget.api),
          ),
        );
        if (mounted) await _reloadNotifications();
      case NotificationTargetKind.external:
        final uri = target.uri;
        if (uri != null) {
          await _openExternalUrl(context, uri, 'contact_open_error'.tr);
        }
        if (mounted) await _reloadNotifications();
      case NotificationTargetKind.none:
        await _reloadNotifications();
    }
  }

  Future<void> _openContactAction(AppContactAction action) async {
    final uri = contactActionUri(action);
    if (uri == null) {
      _showError('contact_open_error'.tr);
      return;
    }
    final opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!opened && mounted) _showError('contact_open_error'.tr);
  }

  void _showError(String message) {
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            _NotificationCenterHeader(
              selectedTab: _selectedTab,
              onBack: () => Navigator.of(context).maybePop(),
              onSelectTab: _selectTab,
              onSettings: _selectedTab == 0 && _isAuthenticated
                  ? () => Navigator.of(context).push<void>(
                      MaterialPageRoute(
                        builder: (_) =>
                            NotificationSettingsScreen(api: widget.api),
                      ),
                    )
                  : null,
            ),
            Expanded(
              child: ColoredBox(
                color: scheme.surface.withValues(alpha: .01),
                child: AnimatedSwitcher(
                  duration: BulkaMotion.reduced(context)
                      ? Duration.zero
                      : const Duration(milliseconds: 220),
                  child: _selectedTab == 0
                      ? _buildNotifications()
                      : _buildContacts(),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildNotifications() {
    if (!_isAuthenticated) {
      return _NotificationGuestState(
        key: const ValueKey('notification-guest'),
        onSignIn: _requestAuthentication,
      );
    }

    final future = _notificationsFuture ??= widget.api.getNotifications();
    return FutureBuilder<List<AppNotification>>(
      key: const ValueKey('notification-list'),
      future: future,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return const Center(child: CircularProgressIndicator());
        }
        if (snapshot.hasError) {
          return _NotificationErrorState(onRetry: _reloadNotifications);
        }
        final items = snapshot.data ?? const <AppNotification>[];
        if (items.isEmpty) {
          return RefreshIndicator(
            color: _bulkaYellow,
            onRefresh: _reloadNotifications,
            child: ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.fromLTRB(24, 56, 24, 40),
              children: const [_NotificationEmptyState()],
            ),
          );
        }

        final hasUnread = items.any((item) => !item.isRead);
        return RefreshIndicator(
          color: _bulkaYellow,
          onRefresh: _reloadNotifications,
          child: ListView.separated(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(16, 18, 16, 32),
            itemCount: items.length + (hasUnread ? 1 : 0),
            separatorBuilder: (_, _) => const SizedBox(height: 12),
            itemBuilder: (context, index) {
              if (hasUnread && index == 0) {
                return Align(
                  alignment: Alignment.centerRight,
                  child: TextButton.icon(
                    onPressed: _markAllRead,
                    icon: const Icon(Icons.done_all_rounded, size: 19),
                    label: Text('notifications_read_all'.tr),
                  ),
                );
              }
              final item = items[index - (hasUnread ? 1 : 0)];
              return _NotificationCard(
                notification: item,
                onTap: () => _openNotification(item),
              );
            },
          ),
        );
      },
    );
  }

  Widget _buildContacts() {
    return FutureBuilder<List<AppContactCard>>(
      key: const ValueKey('contact-list'),
      future: _contactsFuture,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return const Center(child: CircularProgressIndicator());
        }
        if (snapshot.hasError) {
          return _NotificationErrorState(onRetry: _reloadContacts);
        }
        final cards = snapshot.data ?? const <AppContactCard>[];
        if (cards.isEmpty) {
          return RefreshIndicator(
            color: _bulkaYellow,
            onRefresh: _reloadContacts,
            child: ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.fromLTRB(24, 72, 24, 40),
              children: const [_ContactsEmptyState()],
            ),
          );
        }

        final standard = cards.where((card) => !card.isCompact).toList();
        final compact = cards
            .where((card) => card.isCompact && card.actions.isNotEmpty)
            .toList();
        return RefreshIndicator(
          color: _bulkaYellow,
          onRefresh: _reloadContacts,
          child: ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(16, 24, 16, 36),
            children: [
              for (final card in standard) ...[
                _StandardContactCard(card: card, onAction: _openContactAction),
                const SizedBox(height: 16),
              ],
              for (final card in compact) ...[
                Padding(
                  padding: const EdgeInsets.fromLTRB(4, 4, 4, 12),
                  child: Text(
                    card.titleFor(AppLang.current),
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                      color: _bulkaBrown,
                      fontSize: BulkaTypeScale.title,
                      fontWeight: FontWeight.w700,
                      height: 1.15,
                    ),
                  ),
                ),
                _CompactContactGrid(card: card, onAction: _openContactAction),
                const SizedBox(height: 16),
              ],
            ],
          ),
        );
      },
    );
  }
}

class _NotificationCenterHeader extends StatelessWidget {
  const _NotificationCenterHeader({
    required this.selectedTab,
    required this.onBack,
    required this.onSelectTab,
    this.onSettings,
  });

  final int selectedTab;
  final VoidCallback onBack;
  final ValueChanged<int> onSelectTab;
  final VoidCallback? onSettings;

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const ValueKey('notification-center-header'),
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 18),
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(
          bottom: Radius.circular(BulkaRadii.sheet),
        ),
        boxShadow: [
          BoxShadow(
            color: Color(0x146D3317),
            blurRadius: 26,
            offset: Offset(0, 12),
          ),
        ],
      ),
      child: Column(
        children: [
          SizedBox(
            height: BulkaLayout.appBarHeight(context),
            child: Row(
              children: [
                _NotificationHeaderButton(
                  tooltip: MaterialLocalizations.of(context).backButtonTooltip,
                  icon: Icons.arrow_back_rounded,
                  onTap: onBack,
                ),
                Expanded(
                  child: _BulkaPageTitle(
                    'notification_center_title'.tr,
                    key: const ValueKey('notification-center-title'),
                    color: _bulkaBrown,
                  ),
                ),
                if (onSettings != null)
                  _NotificationHeaderButton(
                    tooltip: 'notifications_settings_title'.tr,
                    icon: Icons.tune_rounded,
                    onTap: onSettings!,
                  )
                else
                  const SizedBox(width: 48),
              ],
            ),
          ),
          const SizedBox(height: 12),
          Row(
            key: const ValueKey('notification-tab-row'),
            children: [
              Expanded(
                child: _NotificationTab(
                  key: const ValueKey('notification-tab-notifications'),
                  label: 'notification_tab'.tr,
                  selected: selectedTab == 0,
                  onTap: () => onSelectTab(0),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _NotificationTab(
                  key: const ValueKey('notification-tab-contacts'),
                  label: 'contacts_tab'.tr,
                  selected: selectedTab == 1,
                  onTap: () => onSelectTab(1),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _NotificationHeaderButton extends StatelessWidget {
  const _NotificationHeaderButton({
    required this.tooltip,
    required this.icon,
    required this.onTap,
  });

  final String tooltip;
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: Material(
        color: Colors.white,
        shape: const CircleBorder(),
        elevation: 2,
        shadowColor: const Color(0x26532814),
        child: InkWell(
          customBorder: const CircleBorder(),
          onTap: onTap,
          child: SizedBox(
            width: 48,
            height: 48,
            child: Icon(icon, color: _bulkaBrown, size: 25),
          ),
        ),
      ),
    );
  }
}

class _NotificationTab extends StatelessWidget {
  const _NotificationTab({
    required this.label,
    required this.selected,
    required this.onTap,
    super.key,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      selected: selected,
      child: SizedBox(
        height: 50,
        child: Material(
          color: selected ? _bulkaYellow : Colors.white.withValues(alpha: .94),
          elevation: selected ? 2 : 1,
          shadowColor: const Color(0x26532814),
          clipBehavior: Clip.antiAlias,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(BulkaRadii.control),
            side: BorderSide(
              color: selected
                  ? const Color(0x4DFFB814)
                  : const Color(0x24532814),
            ),
          ),
          child: InkWell(
            onTap: onTap,
            child: Center(
              child: Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: _bulkaBrown,
                  fontSize: BulkaTypeScale.body,
                  fontWeight: selected ? FontWeight.w700 : FontWeight.w700,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _NotificationEmptyState extends StatelessWidget {
  const _NotificationEmptyState();

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Text(
          'notifications_empty'.tr,
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.headlineSmall?.copyWith(
            color: _bulkaBrown,
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(height: 8),
        Text(
          'notifications_empty_body'.tr,
          textAlign: TextAlign.center,
          style: TextStyle(color: context.bulkaColors.mutedText, height: 1.35),
        ),
        const SizedBox(height: 28),
        Image.asset(
          'assets/brand/bulka_notification_envelope.webp',
          width: 270,
          semanticLabel: 'notifications_empty'.tr,
        ),
      ],
    );
  }
}

class _NotificationGuestState extends StatelessWidget {
  const _NotificationGuestState({required this.onSignIn, super.key});

  final VoidCallback onSignIn;

  @override
  Widget build(BuildContext context) {
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(24, 38, 24, 40),
      children: [
        Image.asset(
          'assets/brand/bulka_notification_envelope.webp',
          height: 210,
          fit: BoxFit.contain,
          semanticLabel: 'notifications_guest_title'.tr,
        ),
        const SizedBox(height: 18),
        Text(
          'notifications_guest_title'.tr,
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.headlineSmall?.copyWith(
            color: _bulkaBrown,
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(height: 8),
        Text(
          'notifications_guest_body'.tr,
          textAlign: TextAlign.center,
          style: TextStyle(color: context.bulkaColors.mutedText, height: 1.4),
        ),
        const SizedBox(height: 24),
        FilledButton.icon(
          onPressed: onSignIn,
          icon: const Icon(Icons.login_rounded),
          label: Text('guest_sign_in'.tr),
        ),
      ],
    );
  }
}

class _NotificationErrorState extends StatelessWidget {
  const _NotificationErrorState({required this.onRetry});

  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.cloud_off_rounded, color: _bulkaBrown, size: 52),
            const SizedBox(height: 14),
            Text('error_network'.tr, textAlign: TextAlign.center),
            const SizedBox(height: 18),
            OutlinedButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh_rounded),
              label: Text('common_retry'.tr),
            ),
          ],
        ),
      ),
    );
  }
}

class _ContactsEmptyState extends StatelessWidget {
  const _ContactsEmptyState();

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        const _ContactBrandBadge(height: 76),
        const SizedBox(height: 20),
        Text(
          'contacts_empty'.tr,
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.headlineSmall?.copyWith(
            color: _bulkaBrown,
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(height: 8),
        Text(
          'contacts_empty_body'.tr,
          textAlign: TextAlign.center,
          style: TextStyle(color: context.bulkaColors.mutedText, height: 1.4),
        ),
      ],
    );
  }
}

class _NotificationCard extends StatelessWidget {
  const _NotificationCard({required this.notification, required this.onTap});

  final AppNotification notification;
  final VoidCallback onTap;

  IconData get _icon {
    final type = notification.type.toLowerCase();
    if (type.contains('order')) return Icons.receipt_long_rounded;
    if (type.contains('bonus')) return Icons.card_giftcard_rounded;
    if (type.contains('promo')) return Icons.local_offer_rounded;
    if (type.contains('support')) return Icons.forum_rounded;
    return Icons.notifications_active_rounded;
  }

  @override
  Widget build(BuildContext context) {
    final localizedTitle = notification.titleFor(AppLang.current);
    final localizedBody = notification.bodyFor(AppLang.current);
    return Semantics(
      button: true,
      label: '$localizedTitle. $localizedBody',
      hint: 'notification_open_hint'.tr,
      child: Material(
        color: notification.isRead ? Colors.white : const Color(0xFFFFF5D8),
        borderRadius: BorderRadius.circular(BulkaRadii.card),
        elevation: notification.isRead ? 0 : 1,
        shadowColor: const Color(0x20532814),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(BulkaRadii.card),
          child: Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(BulkaRadii.card),
              border: Border.all(
                color: notification.isRead
                    ? const Color(0xFFEEDFC7)
                    : const Color(0xFFFFD56A),
              ),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    color: notification.isRead
                        ? const Color(0xFFFFF2D1)
                        : _bulkaYellow,
                    borderRadius: BorderRadius.circular(BulkaRadii.control),
                  ),
                  child: Icon(_icon, color: _bulkaBrown, size: 23),
                ),
                const SizedBox(width: 13),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(
                            child: Text(
                              localizedTitle,
                              style: const TextStyle(
                                fontFamily: _headingFont,
                                color: _bulkaBrown,
                                fontWeight: FontWeight.w700,
                                fontSize: BulkaTypeScale.body,
                              ),
                            ),
                          ),
                          if (!notification.isRead)
                            Container(
                              width: 9,
                              height: 9,
                              margin: const EdgeInsets.only(top: 5, left: 8),
                              decoration: const BoxDecoration(
                                color: _bulkaYellow,
                                shape: BoxShape.circle,
                              ),
                            ),
                        ],
                      ),
                      const SizedBox(height: 5),
                      Text(
                        localizedBody,
                        style: TextStyle(
                          color: context.bulkaColors.mutedText,
                          height: 1.35,
                        ),
                      ),
                      if (notification.createdAt.isNotEmpty) ...[
                        const SizedBox(height: 9),
                        Text(
                          formatDateTime(notification.createdAt),
                          style: TextStyle(
                            color: context.bulkaColors.mutedText,
                            fontSize: BulkaTypeScale.caption,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ],
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

class _StandardContactCard extends StatelessWidget {
  const _StandardContactCard({required this.card, required this.onAction});

  final AppContactCard card;
  final ValueChanged<AppContactAction> onAction;

  @override
  Widget build(BuildContext context) {
    final language = AppLang.current;
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(BulkaRadii.card),
        border: Border.all(color: const Color(0xFFEEDFC7)),
        boxShadow: const [
          BoxShadow(
            color: Color(0x14532814),
            blurRadius: 25,
            offset: Offset(0, 12),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const _ContactBrandBadge(height: 58),
              const SizedBox(width: 13),
              Expanded(
                child: Text(
                  card.titleFor(language),
                  style: const TextStyle(
                    fontFamily: _headingFont,
                    color: _bulkaBrown,
                    fontSize: BulkaTypeScale.title,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
          ),
          if (card.actions.isNotEmpty) const SizedBox(height: 18),
          for (var index = 0; index < card.actions.length; index++) ...[
            _ContactActionButton(
              action: card.actions[index],
              onTap: () => onAction(card.actions[index]),
            ),
            if (index != card.actions.length - 1) const SizedBox(height: 10),
          ],
        ],
      ),
    );
  }
}

class _ContactActionButton extends StatelessWidget {
  const _ContactActionButton({required this.action, required this.onTap});

  final AppContactAction action;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final label = action.labelFor(AppLang.current);
    return Semantics(
      button: true,
      label: '$label. ${action.target}',
      child: Material(
        color: const Color(0xFFFFF8E8),
        borderRadius: BorderRadius.circular(BulkaRadii.control),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(BulkaRadii.control),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 11),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                _ContactActionIcon(action: action),
                const SizedBox(width: 11),
                Flexible(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        label,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontFamily: _headingFont,
                          color: _bulkaBrown,
                          fontSize: BulkaTypeScale.body,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      if (action.target != label) ...[
                        const SizedBox(height: 1),
                        Text(
                          action.target,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            color: context.bulkaColors.mutedText,
                            fontSize: BulkaTypeScale.caption,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                const Icon(Icons.chevron_right_rounded, color: _bulkaBrown),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _CompactContactGrid extends StatelessWidget {
  const _CompactContactGrid({required this.card, required this.onAction});

  final AppContactCard card;
  final ValueChanged<AppContactAction> onAction;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        const spacing = 8.0;
        final textScale = MediaQuery.textScalerOf(context).scale(1);
        final columns = constraints.maxWidth < 310 || textScale > 1.35
            ? 2
            : constraints.maxWidth < 680
            ? 3
            : 4;
        final width =
            (constraints.maxWidth - spacing * (columns - 1)) / columns;
        final height = 108.0 + max(0, min(textScale - 1, 1)) * 24;
        return Wrap(
          spacing: spacing,
          runSpacing: spacing,
          children: [
            for (final action in card.actions)
              SizedBox(
                key: ValueKey('compact-contact-tile-${action.id}'),
                width: width,
                height: height,
                child: _CompactContactTile(
                  card: card,
                  action: action,
                  onTap: () => onAction(action),
                ),
              ),
          ],
        );
      },
    );
  }
}

class _CompactContactTile extends StatelessWidget {
  const _CompactContactTile({
    required this.card,
    required this.action,
    required this.onTap,
  });

  final AppContactCard card;
  final AppContactAction action;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final label = action.labelFor(AppLang.current);
    return Semantics(
      button: true,
      label: '${card.titleFor(AppLang.current)}. $label',
      child: Material(
        color: Colors.white,
        borderRadius: BorderRadius.circular(BulkaRadii.control),
        elevation: 1,
        shadowColor: const Color(0x1F532814),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(BulkaRadii.control),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 10),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(BulkaRadii.control),
              border: Border.all(color: const Color(0xFFEEDFC7)),
            ),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                _ContactActionIcon(action: action),
                const SizedBox(height: 7),
                Text(
                  label,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontFamily: _headingFont,
                    color: _bulkaBrown,
                    fontSize: BulkaTypeScale.caption,
                    fontWeight: FontWeight.w700,
                    height: 1.1,
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

class _ContactBrandBadge extends StatelessWidget {
  const _ContactBrandBadge({required this.height});

  final double height;

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const ValueKey('contact-brand-logo'),
      width: height * 1.55,
      height: height,
      padding: EdgeInsets.symmetric(
        horizontal: height * .12,
        vertical: height * .16,
      ),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(height * .28),
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFFFFD66B), _bulkaYellow],
        ),
      ),
      child: Image.asset(
        'assets/brand/bulka_logo.png',
        fit: BoxFit.contain,
        filterQuality: FilterQuality.high,
      ),
    );
  }
}

class _ContactActionIcon extends StatelessWidget {
  const _ContactActionIcon({required this.action});

  static const double frameSize = 42;
  static const double glyphSize = 22;

  final AppContactAction action;

  @override
  Widget build(BuildContext context) {
    return Container(
      key: ValueKey('contact-action-icon-${action.id}'),
      width: frameSize,
      height: frameSize,
      decoration: BoxDecoration(
        color: _bulkaYellow,
        borderRadius: BorderRadius.circular(BulkaRadii.control),
      ),
      alignment: Alignment.center,
      child: _ContactActionGlyph(
        action: action,
        color: _bulkaBrown,
        size: glyphSize,
      ),
    );
  }
}

IconData _contactIcon(AppContactAction action) {
  return switch (action.iconKey) {
    'phone' => Icons.phone_rounded,
    'whatsapp' => Icons.phone_in_talk_rounded,
    'telegram' => Icons.send_rounded,
    'instagram' => Icons.camera_alt_rounded,
    'vk' => Icons.people_alt_rounded,
    'email' => Icons.alternate_email_rounded,
    'website' => Icons.language_rounded,
    'chat' => Icons.forum_rounded,
    _ => Icons.open_in_new_rounded,
  };
}

String? _contactSocialIconAsset(AppContactAction action) {
  const assets = {
    'instagram': 'assets/social/instagram.svg',
    'whatsapp': 'assets/social/whatsapp.svg',
    'telegram': 'assets/social/telegram.svg',
    'vk': 'assets/social/vk.svg',
  };
  return assets[action.iconKey] ?? assets[action.type];
}

class _ContactActionGlyph extends StatelessWidget {
  const _ContactActionGlyph({
    required this.action,
    required this.color,
    required this.size,
  });

  final AppContactAction action;
  final Color color;
  final double size;

  @override
  Widget build(BuildContext context) {
    final asset = _contactSocialIconAsset(action);
    if (asset == null) {
      return Icon(_contactIcon(action), color: color, size: size);
    }
    return SvgPicture.asset(
      asset,
      key: ValueKey('contact-social-icon-${action.type}'),
      width: size,
      height: size,
      fit: BoxFit.contain,
      colorFilter: ColorFilter.mode(color, BlendMode.srcIn),
      excludeFromSemantics: true,
    );
  }
}
