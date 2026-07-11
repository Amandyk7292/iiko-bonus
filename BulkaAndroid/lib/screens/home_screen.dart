part of '../main.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({
    required this.api,
    required this.customer,
    required this.transactions,
    required this.onHistoryTap,
    required this.onProfileTap,
    super.key,
  });

  final BulkaApiClient api;
  final Customer customer;
  final List<BonusTransaction> transactions;
  final VoidCallback onHistoryTap;
  final VoidCallback onProfileTap;

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
  bool _loyaltyExpanded = true;

  @override
  void initState() {
    super.initState();
    _loadCachedFeed();
    _loadViewedStoryGroups();
    _loadFeed();
    _feedRefreshTimer = Timer.periodic(
      const Duration(minutes: 1),
      (_) => _loadFeed(),
    );
  }

  @override
  void dispose() {
    _feedRefreshTimer?.cancel();
    super.dispose();
  }

  Future<void> _loadCachedFeed() async {
    final prefs = await SharedPreferences.getInstance();
    if (!mounted) return;
    final cachedStories = prefs.getString('cached_stories_json');
    final cachedNews = prefs.getString('cached_news_json');
    if (cachedStories != null && _stories.isEmpty) {
      try {
        final decoded = jsonDecode(cachedStories) as List<dynamic>;
        setState(() {
          _stories = decoded
              .map((e) => PromoStory.fromJson(_asMap(e)))
              .toList();
          _initialLoading = false;
        });
      } catch (_) {}
    }
    if (cachedNews != null && _news.isEmpty) {
      try {
        final decoded = jsonDecode(cachedNews) as List<dynamic>;
        setState(() {
          _news = decoded.map((e) => NewsItem.fromJson(_asMap(e))).toList();
        });
      } catch (_) {}
    }
  }

  Future<void> _loadViewedStoryGroups() async {
    final prefs = await SharedPreferences.getInstance();
    if (!mounted) return;
    setState(() {
      _viewedStoryGroups =
          (prefs.getStringList('viewed_story_groups') ?? const []).toSet();
    });
  }

  Future<void> _loadFeed() async {
    if (_feedLoading) return;
    _feedLoading = true;
    try {
      final results = await Future.wait<Object?>([
        widget.api
            .getStories()
            .then<Object?>((value) => value)
            .catchError((_) => null),
        widget.api
            .getNews()
            .then<Object?>((value) => value)
            .catchError((_) => null),
      ]);
      if (!mounted) return;
      setState(() {
        final stories = results[0];
        final news = results[1];
        if (stories is List<PromoStory>) {
          _stories = stories;
          SharedPreferences.getInstance().then((prefs) {
            prefs.setString(
              'cached_stories_json',
              jsonEncode(stories.map((s) => s.toJson()).toList()),
            );
          });
        }
        if (news is List<NewsItem>) {
          _news = news;
          SharedPreferences.getInstance().then((prefs) {
            prefs.setString(
              'cached_news_json',
              jsonEncode(news.map((n) => n.toJson()).toList()),
            );
          });
        }
        _initialLoading = false;
      });
    } finally {
      _feedLoading = false;
      if (mounted && _initialLoading) {
        setState(() {
          _initialLoading = false;
        });
      }
    }
  }

  Future<void> _openDeliveryAddresses() async {
    await Navigator.of(
      context,
    ).push(MaterialPageRoute(builder: (_) => const AddressSelectionScreen()));
  }

  Future<void> _openBakeryLocations(String orderType) async {
    final location = await Navigator.of(
      context,
    ).push<String>(MaterialPageRoute(builder: (_) => const LocationsScreen()));
    if (!mounted || location == null || location.trim().isEmpty) return;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('selected_bakery_location', location);
    await prefs.setString('selected_order_type', orderType);
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('bakery_selected'.trArgs({'name': location}))),
    );
  }

  Future<void> _openQr() async {
    BulkaMotion.lightImpact();
    // A dialog route keeps the current home screen beneath the QR card.  The
    // former opaque page route painted a black Scaffold over it, so the app
    // background disappeared completely instead of being softly dimmed.
    await showDialog<void>(
      context: context,
      barrierDismissible: true,
      barrierLabel: 'close_tooltip'.tr,
      barrierColor: _cocoa.withValues(alpha: 0.18),
      builder: (_) => QrDialog(
        api: widget.api,
        customer: widget.customer,
        heroTag: 'qr-${widget.customer.phone}',
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final customer = widget.customer;
    final storyGroups = _groupStories(_stories);

    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        bottom: false,
        child: LayoutBuilder(
          builder: (context, constraints) {
            return RefreshIndicator(
              color: _caramel,
              backgroundColor: Colors.white,
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
                        padding: const EdgeInsets.fromLTRB(8, 16, 24, 8),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Transform.translate(
                              offset: const Offset(-12, 0),
                              child: Image.asset(
                                'assets/brand/bulka_logo.png',
                                semanticLabel: 'app_title'.tr,
                                width: 165,
                                height: 64,
                                fit: BoxFit.contain,
                                alignment: Alignment.centerLeft,
                                filterQuality: FilterQuality.high,
                              ),
                            ),
                            Row(
                              children: [
                                _IconCircleButton(
                                  tooltip: 'locations_tooltip'.tr,
                                  icon: Icons.location_on_outlined,
                                  onTap: () {
                                    Navigator.of(context).push(
                                      MaterialPageRoute(
                                        builder: (_) => const LocationsScreen(),
                                      ),
                                    );
                                  },
                                ),
                                const SizedBox(width: 8),
                                _IconCircleButton(
                                  tooltip: 'notifications_tooltip'.tr,
                                  icon: Icons.notifications_none_rounded,
                                  onTap: () => Navigator.of(context).push<void>(
                                    MaterialPageRoute(
                                      builder: (_) =>
                                          NotificationsScreen(api: widget.api),
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                      if (_initialLoading || storyGroups.isNotEmpty) ...[
                        Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 24),
                          child: _SectionTitle('home_interesting'.tr),
                        ),
                        const SizedBox(height: 14),
                        if (_initialLoading)
                          const PromoBannerShimmer()
                        else
                          PromoBannerSlider(
                            groups: storyGroups,
                            viewedGroups: _viewedStoryGroups,
                            onGroupTap: _openStoryGroup,
                          ),
                        const SizedBox(height: 24),
                      ],
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 24),
                        child: _SectionTitle('home_select_order_type'.tr),
                      ),
                      const SizedBox(height: 20),
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 24),
                        child: _OrderTypeSection(
                          onDeliveryTap: _openDeliveryAddresses,
                          onPickupTap: () => _openBakeryLocations('pickup'),
                          onPreorderTap: () => _openBakeryLocations('preorder'),
                        ),
                      ),
                      const SizedBox(height: 28),
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 24),
                        child: _SectionTitle('home_loyalty_header'.tr),
                      ),
                      const SizedBox(height: 18),
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 24),
                        child: _LoyaltyPanel(
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
                          padding: const EdgeInsets.symmetric(horizontal: 24),
                          child: NewsFeed(news: _news),
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
            title: first.groupTitle.isNotEmpty ? first.groupTitle : first.title,
            subtitle: first.description?.isNotEmpty == true
                ? first.description
                : first.title,
            coverUrl: first.groupCoverUrl.isNotEmpty
                ? first.groupCoverUrl
                : first.imageUrl,
            stories: items,
          );
        }).toList()..sort(
          (a, b) => a.stories.first.id.compareTo(b.stories.first.id),
        );
    return groups;
  }

  Future<void> _openStoryGroup(StoryGroup group) async {
    await Navigator.of(context).push<void>(
      MaterialPageRoute(
        builder: (_) => StoryViewer(
          stories: group.stories,
          initialIndex: 0,
          heroTag: 'promo-${group.id}',
        ),
      ),
    );
    await _markStoryGroupViewed(group.id);
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

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      style: const TextStyle(
        color: Color(0xFF6D3317),
        fontFamily: _headingFont,
        fontSize: 27,
        height: 1.05,
        fontWeight: FontWeight.w400,
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
    return IconButton(
      onPressed: () {
        BulkaMotion.lightImpact();
        onTap();
      },
      tooltip: tooltip,
      style: IconButton.styleFrom(
        foregroundColor: const Color(0xFF6D3317),
        minimumSize: const Size(48, 48),
        tapTargetSize: MaterialTapTargetSize.padded,
      ),
      icon: Icon(icon, size: 32),
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
              const SizedBox(height: 14),
              _OrderTypeCard(
                title: 'order_preorder'.tr,
                illustration: _OrderIllustrationKind.preorder,
                onTap: onPreorderTap,
              ),
            ],
          ),
        ),
        const SizedBox(width: 14),
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
    final illustrationWidth = tall ? 178.0 : 88.0;
    final cacheWidth =
        (illustrationWidth * MediaQuery.devicePixelRatioOf(context)).ceil();
    return BulkaPressScale(
      enabled: onTap != null,
      child: SizedBox(
        height: tall ? 208 : 100,
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: onTap == null
                ? null
                : () {
                    BulkaMotion.lightImpact();
                    onTap!();
                  },
            borderRadius: BorderRadius.circular(24),
            child: Ink(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(24),
                gradient: const LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [Color(0xFFFFD54F), Color(0xFFFFB300)],
                ),
              ),
              child: Stack(
                clipBehavior: Clip.hardEdge,
                children: [
                  Positioned(
                    right: tall ? -18 : -10,
                    bottom: tall ? 10 : -14,
                    child: SizedBox(
                      width: tall ? 175 : 105,
                      height: tall ? 175 : 105,
                      child: const CustomPaint(painter: _OrderSplashPainter()),
                    ),
                  ),
                  Positioned(
                    right: tall ? -34 : 0,
                    bottom: tall ? -8 : -12,
                    child: SizedBox(
                      width: illustrationWidth,
                      height: tall ? 172 : 84,
                      child: Image.asset(
                        illustration.assetPath,
                        fit: BoxFit.contain,
                        cacheWidth: cacheWidth,
                        filterQuality: FilterQuality.medium,
                      ),
                    ),
                  ),
                  Positioned(
                    left: 14,
                    top: 16,
                    right: 12,
                    child: _OrderCardTitle(title: title, tall: tall),
                  ),
                  Positioned(
                    left: 14,
                    bottom: 16,
                    child: Container(
                      width: 38,
                      height: 38,
                      decoration: const BoxDecoration(
                        color: Colors.white,
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(
                        Icons.chevron_right_rounded,
                        color: Color(0xFF6D3317),
                        size: 28,
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

class _OrderSplashPainter extends CustomPainter {
  const _OrderSplashPainter();

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = Colors.white.withValues(alpha: 0.45)
      ..style = PaintingStyle.fill;

    final center = Offset(size.width * 0.5, size.height * 0.5);
    final radius = size.width * 0.42;
    final waveDepth = size.width * 0.08;
    const petals = 10;

    final path = Path();
    const steps = 120;
    for (int i = 0; i <= steps; i++) {
      final t = (i / steps) * 2 * pi;
      final r = radius + waveDepth * cos(petals * t);
      final x = center.dx + r * cos(t);
      final y = center.dy + r * sin(t);
      if (i == 0) {
        path.moveTo(x, y);
      } else {
        path.lineTo(x, y);
      }
    }
    path.close();

    canvas.drawPath(path, paint);
  }

  @override
  bool shouldRepaint(covariant _OrderSplashPainter oldDelegate) => false;
}

enum _OrderIllustrationKind {
  pickup('assets/order/pickup.png'),
  preorder('assets/order/preorder.png'),
  delivery('assets/order/delivery.png');

  const _OrderIllustrationKind(this.assetPath);

  final String assetPath;
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
      fontSize: 19,
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
