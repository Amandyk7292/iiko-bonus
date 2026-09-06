part of '../main.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({
    required this.api,
    required this.customer,
    required this.transactions,
    required this.onHistoryTap,
    required this.onProfileTap,
    required this.onRequireAuth,
    required this.onOpenCatalog,
    this.onOpenNotificationTab,
    this.onOpenOrders,
    super.key,
  });

  final BulkaApiClient api;
  final Customer? customer;
  final List<BonusTransaction> transactions;
  final VoidCallback onHistoryTap;
  final VoidCallback onProfileTap;
  final Future<bool> Function() onRequireAuth;
  final Future<void> Function(String orderType) onOpenCatalog;
  final ValueChanged<int>? onOpenNotificationTab;
  final Future<void> Function(String? orderId)? onOpenOrders;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  List<PromoStory> _stories = const [];
  List<NewsItem> _news = const [];
  Set<String> _viewedStoryGroups = const {};
  Timer? _feedRefreshTimer;
  bool _feedLoading = false;
  bool _initialLoading = true;
  bool _storiesLoadFailed = false;
  bool _newsLoadFailed = false;
  bool _loyaltyExpanded = true;
  final _navigationGate = _AsyncActionGate();

  @override
  void initState() {
    super.initState();
    unawaited(_initializeFeed());
    unawaited(_loadViewedStoryGroups());
    _feedRefreshTimer = Timer.periodic(const Duration(minutes: 1), (_) {
      if (mounted &&
          TickerMode.of(context) &&
          WidgetsBinding.instance.lifecycleState == AppLifecycleState.resumed) {
        unawaited(_loadFeed());
      }
    });
  }

  @override
  void dispose() {
    _feedRefreshTimer?.cancel();
    super.dispose();
  }

  void _updateHomeState(VoidCallback update) => setState(update);

  Future<void> _openDeliveryAddresses() async {
    await _navigationGate.run(() async {
      if (widget.customer == null && !await widget.onRequireAuth()) return;
      try {
        final locations = await widget.api.getFulfillmentLocations();
        final deliveryAvailable = locations.any(
          (location) => location.active && location.deliveryEnabled,
        );
        if (!deliveryAvailable) {
          if (!mounted) return;
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('checkout_delivery_unavailable'.tr)),
          );
          return;
        }
      } catch (error) {
        if (!mounted) return;
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(localizeErrorMessage(error))));
        return;
      }
      if (!mounted) return;
      final address = await Navigator.of(context).push<DeliveryAddress>(
        MaterialPageRoute(
          builder: (_) => AddressSelectionScreen(api: widget.api),
        ),
      );
      if (!mounted || address == null) return;
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('selected_order_type', 'delivery');
      await Future.wait([
        prefs.remove('selected_bakery_location'),
        prefs.remove('selected_bakery_location_id'),
      ]);
      if (!mounted) return;
      await widget.onOpenCatalog('delivery');
    });
  }

  Future<void> _openBakeryLocations(String orderType) async {
    await _navigationGate.run(() async {
      final location = await Navigator.of(context).push<String>(
        MaterialPageRoute(
          builder: (_) => LocationsScreen(orderType: orderType),
        ),
      );
      if (!mounted || location == null || location.trim().isEmpty) return;
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('selected_bakery_location', location);
      await prefs.setString('selected_order_type', orderType);
      if (!mounted) return;
      await widget.onOpenCatalog(orderType);
    });
  }

  Future<void> _openLocationsDirectory() async {
    await _navigationGate.run(() async {
      await Navigator.of(
        context,
      ).push<void>(MaterialPageRoute(builder: (_) => const LocationsScreen()));
    });
  }

  Future<void> _openNotifications() async {
    await _navigationGate.run(() async {
      await Navigator.of(context).push<void>(
        MaterialPageRoute(
          builder: (_) => NotificationsScreen(
            api: widget.api,
            onRequireAuth: widget.onRequireAuth,
            onOpenTab: widget.onOpenNotificationTab,
            onOpenOrders: widget.onOpenOrders,
          ),
        ),
      );
    });
  }

  Future<void> _openQr() async {
    await _navigationGate.run(() async {
      final customer = widget.customer;
      if (customer == null) {
        await widget.onRequireAuth();
        return;
      }
      BulkaMotion.lightImpact();
      // A dialog route keeps the current home screen beneath the QR card.  The
      // former opaque page route painted a black Scaffold over it, so the app
      // background disappeared completely instead of being softly dimmed.
      await showDialog<void>(
        context: context,
        barrierDismissible: true,
        barrierLabel: 'close_tooltip'.tr,
        barrierColor: kIsWeb
            ? Colors.white.withValues(alpha: 0.72)
            : _cocoa.withValues(alpha: 0.18),
        builder: (_) => QrDialog(
          api: widget.api,
          customer: customer,
          heroTag: 'qr-${customer.phone}',
        ),
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    final customer = widget.customer;
    final storyGroups = _groupStories(_stories);

    return Scaffold(
      backgroundColor: Theme.of(context).colorScheme.surface,
      body: SafeArea(
        bottom: false,
        child: LayoutBuilder(
          builder: (context, constraints) {
            return RefreshIndicator(
              color: _caramel,
              backgroundColor: Theme.of(context).colorScheme.surface,
              onRefresh: _loadFeed,
              child: SingleChildScrollView(
                key: const PageStorageKey('home-scroll'),
                physics: const AlwaysScrollableScrollPhysics(),
                padding: EdgeInsets.only(
                  bottom: BulkaLayout.bottomNavContentInset(context),
                ),
                child: ConstrainedBox(
                  constraints: BoxConstraints(minHeight: constraints.maxHeight),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Padding(
                        padding: const EdgeInsets.fromLTRB(16, 4, 16, 4),
                        child: SizedBox(
                          key: const ValueKey('home-header'),
                          height: 56,
                          child: Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              const _BulkaHeaderLogo(),
                              Row(
                                children: [
                                  _IconCircleButton(
                                    tooltip: 'locations_tooltip'.tr,
                                    icon: Icons.location_on_outlined,
                                    onTap: _openLocationsDirectory,
                                  ),
                                  const SizedBox(width: 4),
                                  _IconCircleButton(
                                    tooltip: 'notifications_tooltip'.tr,
                                    icon: Icons.notifications_none_rounded,
                                    onTap: _openNotifications,
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ),
                      ),
                      if (_initialLoading ||
                          storyGroups.isNotEmpty ||
                          (_storiesLoadFailed && _stories.isEmpty)) ...[
                        if (_initialLoading)
                          const PromoBannerShimmer()
                        else if (storyGroups.isNotEmpty)
                          PromoBannerSlider(
                            groups: storyGroups,
                            viewedGroups: _viewedStoryGroups,
                            onGroupTap: _openStoryGroup,
                          )
                        else
                          Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 16),
                            child: _HomeFeedErrorCard(
                              message: 'home_promos_load_error'.tr,
                              onRetry: _loadFeed,
                            ),
                          ),
                        const SizedBox(height: 18),
                      ],
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 16),
                        child: _SectionTitle('home_select_order_type'.tr),
                      ),
                      const SizedBox(height: 16),
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 16),
                        child: _OrderTypeSection(
                          onDeliveryTap: _openDeliveryAddresses,
                          onPickupTap: () => _openBakeryLocations('pickup'),
                          onPreorderTap: () => _openBakeryLocations('preorder'),
                        ),
                      ),
                      const SizedBox(height: 24),
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 16),
                        child: _SectionTitle('home_loyalty_header'.tr),
                      ),
                      const SizedBox(height: 16),
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 16),
                        child: customer == null
                            ? _GuestLoyaltyCard(onSignIn: widget.onRequireAuth)
                            : _LoyaltyPanel(
                                api: widget.api,
                                customer: customer,
                                transactions: widget.transactions,
                                expanded: _loyaltyExpanded,
                                onToggle: () => setState(
                                  () => _loyaltyExpanded = !_loyaltyExpanded,
                                ),
                                onHistoryTap: widget.onHistoryTap,
                                onQrTap: _openQr,
                              ),
                      ),
                      if (_news.isNotEmpty) ...[
                        const SizedBox(height: 24),
                        Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 16),
                          child: NewsFeed(news: _news),
                        ),
                      ] else if (_newsLoadFailed) ...[
                        const SizedBox(height: 24),
                        Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 16),
                          child: _HomeFeedErrorCard(
                            message: 'home_news_load_error'.tr,
                            onRetry: _loadFeed,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            );
          },
        ),
      ),
    );
  }

  List<StoryGroup> _groupStories(List<PromoStory> stories) {
    if (stories.isEmpty) {
      return const [];
    }

    final byGroup = <String, List<PromoStory>>{};
    for (final story in stories) {
      byGroup.putIfAbsent(story.groupId, () => []).add(story);
    }
    final groups =
        byGroup.entries.map((entry) {
            final items = [...entry.value]
              ..sort((a, b) {
                final byOrder = a.sortOrder.compareTo(b.sortOrder);
                if (byOrder != 0) return byOrder;
                return a.id.compareTo(b.id);
              });
            final first = items.first;
            return StoryGroup(
              id: entry.key,
              title: first.localizedGroupTitle.isNotEmpty
                  ? first.localizedGroupTitle
                  : first.localizedTitle,
              subtitle: first.localizedDescription?.isNotEmpty == true
                  ? first.localizedDescription
                  : first.localizedTitle,
              coverUrl: first.localizedGroupCoverUrl.isNotEmpty
                  ? first.localizedGroupCoverUrl
                  : first.localizedImageUrl,
              stories: items,
            );
          }).toList()
          ..sort((a, b) => a.stories.first.id.compareTo(b.stories.first.id));
    return groups;
  }

  Future<void> _openStoryGroup(StoryGroup group) async {
    await _navigationGate.run(() async {
      final sequence = _groupStories(
        _stories,
      ).expand((item) => item.stories).toList(growable: false);
      if (sequence.isEmpty) return;
      final matchedIndex = sequence.indexWhere(
        (story) => story.id == group.stories.first.id,
      );
      await Navigator.of(context).push<void>(
        MaterialPageRoute(
          builder: (_) => StoryViewer(
            stories: sequence,
            initialIndex: matchedIndex < 0 ? 0 : matchedIndex,
            heroTag: 'promo-${group.id}',
          ),
        ),
      );
      await _markStoryGroupViewed(group.id);
    });
  }

  Future<void> _markStoryGroupViewed(String groupId) async {
    if (_viewedStoryGroups.contains(groupId)) return;
    final next = {..._viewedStoryGroups, groupId};
    final prefs = await SharedPreferences.getInstance();
    await prefs.setStringList('viewed_story_groups', next.toList());
    if (!mounted) return;
    setState(() => _viewedStoryGroups = next);
  }
}

class _HomeFeedErrorCard extends StatelessWidget {
  const _HomeFeedErrorCard({required this.message, required this.onRetry});

  final String message;
  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    return Semantics(
      container: true,
      liveRegion: true,
      explicitChildNodes: true,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.fromLTRB(16, 14, 12, 14),
        decoration: BoxDecoration(
          color: colors.surfaceCream,
          borderRadius: BorderRadius.circular(BulkaRadii.control),
          border: Border.all(color: colors.cardBorder),
        ),
        child: Row(
          children: [
            Icon(Icons.cloud_off_rounded, color: colors.mutedText, size: 24),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                message,
                style: TextStyle(
                  color: colors.mutedText,
                  fontSize: BulkaTypeScale.bodySmall,
                  height: 1.35,
                ),
              ),
            ),
            const SizedBox(width: 8),
            TextButton(
              onPressed: () => unawaited(onRetry()),
              child: Text('retry_btn'.tr),
            ),
          ],
        ),
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      style: TextStyle(
        color: context.bulkaColors.brandBrown,
        fontFamily: _headingFont,
        fontSize: BulkaTypeScale.title,
        height: 1.15,
        fontWeight: FontWeight.w700,
      ),
    );
  }
}

class _BulkaHeaderLogo extends StatelessWidget {
  const _BulkaHeaderLogo();

  @override
  Widget build(BuildContext context) {
    // The source logo contains large transparent margins. Crop them at layout
    // time so the visible mark follows the same 16 dp grid as the content.
    return SizedBox(
      key: const ValueKey('home-brand-logo'),
      width: 100,
      height: 56,
      child: ClipRect(
        child: OverflowBox(
          alignment: Alignment.center,
          minWidth: 235,
          maxWidth: 235,
          minHeight: 82,
          maxHeight: 82,
          child: ColorFiltered(
            colorFilter: ColorFilter.mode(
              context.bulkaColors.brandBrown,
              BlendMode.srcIn,
            ),
            child: Image.asset(
              'assets/brand/bulka_logo.png',
              semanticLabel: 'app_title'.tr,
              width: 235,
              height: 82,
              fit: BoxFit.contain,
              filterQuality: FilterQuality.high,
            ),
          ),
        ),
      ),
    );
  }
}

class _IconCircleButton extends StatelessWidget {
  const _IconCircleButton({
    required this.tooltip,
    required this.icon,
    required this.onTap,
  });

  final String tooltip;
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return BulkaPressScale(
      pressedScale: 0.92,
      pressedOpacity: 0.82,
      child: IconButton(
        onPressed: () {
          BulkaMotion.lightImpact();
          onTap();
        },
        tooltip: tooltip,
        style: IconButton.styleFrom(
          foregroundColor: context.bulkaColors.brandBrown,
          minimumSize: const Size(48, 48),
          tapTargetSize: MaterialTapTargetSize.padded,
        ),
        icon: Icon(icon, size: 28),
      ),
    );
  }
}

class _GuestLoyaltyCard extends StatelessWidget {
  const _GuestLoyaltyCard({required this.onSignIn});

  final Future<bool> Function() onSignIn;

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    return Semantics(
      container: true,
      label: '${'guest_loyalty_heading'.tr}. ${'guest_loyalty_body'.tr}',
      child: Container(
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          color: colors.surfaceCream,
          borderRadius: BorderRadius.circular(BulkaRadii.card),
          border: Border.all(color: colors.cardBorder),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 52,
                  height: 52,
                  decoration: BoxDecoration(
                    color: colors.brandGold.withValues(alpha: 0.18),
                    borderRadius: BorderRadius.circular(BulkaRadii.control),
                  ),
                  child: Icon(
                    Icons.account_balance_wallet_outlined,
                    color: colors.brandBrown,
                  ),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Text(
                    'guest_loyalty_heading'.tr,
                    style: const TextStyle(
                      fontFamily: _headingFont,
                      fontSize: BulkaTypeScale.titleSmall,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            Text(
              'guest_loyalty_body'.tr,
              style: TextStyle(
                color: colors.mutedText,
                fontSize: BulkaTypeScale.body,
                height: 1.4,
              ),
            ),
            const SizedBox(height: 18),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                onPressed: () => unawaited(onSignIn()),
                icon: const Icon(Icons.login_rounded),
                label: Text('guest_sign_in'.tr),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _OrderTypeSection extends StatelessWidget {
  const _OrderTypeSection({
    required this.onDeliveryTap,
    required this.onPickupTap,
    required this.onPreorderTap,
  });

  final VoidCallback onDeliveryTap;
  final VoidCallback onPickupTap;
  final VoidCallback onPreorderTap;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Column(
            children: [
              _OrderTypeCard(
                title: 'order_pickup'.tr,
                illustration: _OrderIllustrationKind.pickup,
                onTap: onPickupTap,
              ),
              const SizedBox(height: 10),
              _OrderTypeCard(
                title: 'order_preorder'.tr,
                illustration: _OrderIllustrationKind.preorder,
                onTap: onPreorderTap,
              ),
            ],
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: _OrderTypeCard(
            title: 'order_delivery'.tr,
            illustration: _OrderIllustrationKind.delivery,
            tall: true,
            onTap: onDeliveryTap,
          ),
        ),
      ],
    );
  }
}

class _OrderTypeCard extends StatelessWidget {
  const _OrderTypeCard({
    required this.title,
    required this.illustration,
    this.onTap,
    this.tall = false,
  });

  final String title;
  final _OrderIllustrationKind illustration;
  final VoidCallback? onTap;
  final bool tall;

  @override
  Widget build(BuildContext context) {
    final illustrationWidth = tall ? 192.0 : 118.0;
    final cacheWidth =
        (illustrationWidth * MediaQuery.devicePixelRatioOf(context)).ceil();
    return BulkaPressScale(
      enabled: onTap != null,
      child: SizedBox(
        key: ValueKey('order-card-${illustration.name}'),
        height: tall ? 174 : 82,
        child: Material(
          key: ValueKey('order-card-clip-${illustration.name}'),
          color: Colors.transparent,
          borderRadius: BorderRadius.circular(BulkaRadii.card),
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            onTap: onTap == null
                ? null
                : () {
                    BulkaMotion.lightImpact();
                    onTap!();
                  },
            borderRadius: BorderRadius.circular(BulkaRadii.control),
            child: Ink(
              key: ValueKey('order-card-background-${illustration.name}'),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(BulkaRadii.control),
                gradient: const LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [Color(0xFFFFD54F), Color(0xFFFFB300)],
                ),
                image: const DecorationImage(
                  image: AssetImage('assets/order/berliner_oreo_cluster.webp'),
                  fit: BoxFit.cover,
                  alignment: Alignment.center,
                  opacity: 0.34,
                ),
              ),
              child: Stack(
                clipBehavior: Clip.hardEdge,
                children: [
                  Positioned(
                    // Keep the compact-card artwork anchored to the outer
                    // right corner, away from the title's reading zone.
                    right: tall ? -46 : -29,
                    // Short illustrations have transparent space above the
                    // artwork. Lower the source canvas so the first visible
                    // pixels start below the title instead of behind it.
                    bottom: tall ? -18 : -34,
                    child: SizedBox(
                      key: ValueKey('order-illustration-${illustration.name}'),
                      width: illustrationWidth,
                      height: tall ? 170 : 88,
                      child: _DeferredOrderIllustration(
                        assetPath: illustration.assetPath,
                        fit: BoxFit.contain,
                        cacheWidth: cacheWidth,
                      ),
                    ),
                  ),
                  Positioned(
                    left: 12,
                    top: 12,
                    right: 10,
                    child: _OrderCardTitle(title: title, tall: tall),
                  ),
                  Positioned(
                    left: 12,
                    bottom: 10,
                    child: Container(
                      width: 30,
                      height: 30,
                      decoration: const BoxDecoration(
                        color: Colors.white,
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(
                        Icons.chevron_right_rounded,
                        color: Color(0xFF6D3317),
                        size: 22,
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

enum _OrderIllustrationKind {
  pickup('assets/order/pickup.webp'),
  preorder('assets/order/preorder.webp'),
  delivery('assets/order/delivery.webp');

  const _OrderIllustrationKind(this.assetPath);

  final String assetPath;
}

class _DeferredOrderIllustration extends StatefulWidget {
  const _DeferredOrderIllustration({
    required this.assetPath,
    required this.fit,
    required this.cacheWidth,
  });

  final String assetPath;
  final BoxFit fit;
  final int cacheWidth;

  @override
  State<_DeferredOrderIllustration> createState() =>
      _DeferredOrderIllustrationState();
}

class _DeferredOrderIllustrationState
    extends State<_DeferredOrderIllustration> {
  bool _ready = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) setState(() => _ready = true);
    });
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedOpacity(
      opacity: _ready ? 1 : 0,
      duration: BulkaMotion.fast,
      curve: BulkaMotion.standardCurve,
      child: _ready
          ? Image.asset(
              widget.assetPath,
              fit: widget.fit,
              cacheWidth: widget.cacheWidth,
              filterQuality: FilterQuality.medium,
            )
          : const SizedBox.expand(),
    );
  }
}

class _OrderCardTitle extends StatelessWidget {
  const _OrderCardTitle({required this.title, required this.tall});

  final String title;
  final bool tall;

  @override
  Widget build(BuildContext context) {
    const style = TextStyle(
      color: Color(0xFF6D3317),
      fontFamily: _headingFont,
      fontSize: BulkaTypeScale.titleSmall,
      height: 1.08,
      fontWeight: FontWeight.w400,
    );
    final words = title.split(' ');

    return LayoutBuilder(
      builder: (context, constraints) {
        final painter = TextPainter(
          text: TextSpan(text: title, style: style),
          maxLines: 1,
          textDirection: TextDirection.ltr,
        )..layout(maxWidth: double.infinity);
        final split =
            !tall && words.length > 1 && painter.width > constraints.maxWidth;

        if (!split) {
          return FittedBox(
            alignment: Alignment.centerLeft,
            fit: BoxFit.scaleDown,
            child: Text(title, maxLines: 1, softWrap: false, style: style),
          );
        }

        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (final word in words.take(2))
              FittedBox(
                alignment: Alignment.centerLeft,
                fit: BoxFit.scaleDown,
                child: Text(word, maxLines: 1, softWrap: false, style: style),
              ),
          ],
        );
      },
    );
  }
}
