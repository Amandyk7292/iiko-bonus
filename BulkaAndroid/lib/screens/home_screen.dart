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
  bool _loyaltyExpanded = true;

  @override
  void initState() {
    super.initState();
    _loadViewedStoryGroups();
    _loadFeed();
    _feedRefreshTimer = Timer.periodic(
      const Duration(seconds: 5),
      (_) => _loadFeed(),
    );
  }

  @override
  void dispose() {
    _feedRefreshTimer?.cancel();
    super.dispose();
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
        if (stories is List<PromoStory>) _stories = stories;
        if (news is List<NewsItem>) _news = news;
      });
    } finally {
      _feedLoading = false;
    }
  }

  Future<void> _openDeliveryAddresses() async {
    await Navigator.of(
      context,
    ).push(MaterialPageRoute(builder: (_) => const AddressSelectionScreen()));
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
                padding: const EdgeInsets.only(bottom: 132),
                child: ConstrainedBox(
                  constraints: BoxConstraints(minHeight: constraints.maxHeight),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Padding(
                        padding: const EdgeInsets.fromLTRB(24, 22, 24, 12),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Image.asset(
                              'assets/brand/bulka_logo.png',
                              width: 118,
                              height: 54,
                              fit: BoxFit.contain,
                              alignment: Alignment.centerLeft,
                              filterQuality: FilterQuality.high,
                            ),
                            Row(
                              children: [
                                _IconCircleButton(
                                  tooltip: 'Локации',
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
                                  tooltip: 'Уведомления',
                                  icon: Icons.notifications_none_rounded,
                                  onTap: _loadFeed,
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                      const Padding(
                        padding: EdgeInsets.symmetric(horizontal: 24),
                        child: _SectionTitle('Тут много интересного'),
                      ),
                      const SizedBox(height: 14),
                      PromoBannerSlider(
                        groups: storyGroups,
                        viewedGroups: _viewedStoryGroups,
                        onGroupTap: _openStoryGroup,
                      ),
                      const SizedBox(height: 24),
                      const Padding(
                        padding: EdgeInsets.symmetric(horizontal: 24),
                        child: _SectionTitle('Выберите тип заказа'),
                      ),
                      const SizedBox(height: 20),
                      Padding(
                        padding: EdgeInsets.symmetric(horizontal: 24),
                        child: _OrderTypeSection(
                          onDeliveryTap: _openDeliveryAddresses,
                        ),
                      ),
                      const SizedBox(height: 28),
                      const Padding(
                        padding: EdgeInsets.symmetric(horizontal: 24),
                        child: _SectionTitle('Накопительная'),
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
                          onQrTap: () => showDialog<void>(
                            context: context,
                            builder: (_) =>
                                QrDialog(api: widget.api, customer: customer),
                          ),
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
      return const [
        StoryGroup(
          id: 'happy_hours',
          title: 'СЧАСТЛИВЫЕ ЧАСЫ',
          subtitle: 'После 21:00 — 3 булочки по цене 2-х!',
          coverUrl: '',
          stories: [
            PromoStory(
              id: 991,
              title: 'ЗАБЕРИТЕ ВКУСНЫЙ БОНУС К ВЕЧЕРУ',
              description: '3 булочки по цене 2х после 21:00',
              imageUrl: '',
              contentUrl: '',
              groupId: 'happy_hours',
              groupTitle: 'СЧАСТЛИВЫЕ ЧАСЫ',
              groupCoverUrl: '',
            ),
          ],
        ),
        StoryGroup(
          id: 'invite_friend',
          title: 'ПЛЮШКИ ЗА ДРУГА',
          subtitle: 'Пригласите друга и получите 500 баллов',
          coverUrl: '',
          stories: [
            PromoStory(
              id: 992,
              title: 'ДАРИМ БОНУСЫ ЗА ДРУЗЕЙ',
              description: 'Поделитесь приложением с другом и получайте бонусные баллы на свой счет с каждой покупки!',
              imageUrl: '',
              contentUrl: '',
              groupId: 'invite_friend',
              groupTitle: 'ПЛЮШКИ ЗА ДРУГА',
              groupCoverUrl: '',
            ),
          ],
        ),
      ];
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
            subtitle: first.description?.isNotEmpty == true ? first.description : first.title,
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
    await showGeneralDialog<void>(
      context: context,
      barrierDismissible: true,
      barrierLabel: 'Story',
      barrierColor: Colors.black,
      pageBuilder: (_, _, _) =>
          StoryViewer(stories: group.stories, initialIndex: 0),
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
        color: Colors.black,
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
      onPressed: onTap,
      tooltip: tooltip,
      style: IconButton.styleFrom(
        foregroundColor: const Color(0xFF201A18),
        minimumSize: const Size(48, 48),
        tapTargetSize: MaterialTapTargetSize.padded,
      ),
      icon: Icon(icon, size: 32),
    );
  }
}

class _OrderTypeSection extends StatelessWidget {
  const _OrderTypeSection({required this.onDeliveryTap});

  final VoidCallback onDeliveryTap;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Expanded(
          child: Column(
            children: [
              _OrderTypeCard(
                title: 'Самовывоз',
                illustration: _OrderIllustrationKind.pickup,
              ),
              SizedBox(height: 14),
              _OrderTypeCard(
                title: 'Пред заказ',
                illustration: _OrderIllustrationKind.preorder,
              ),
            ],
          ),
        ),
        const SizedBox(width: 14),
        Expanded(
          child: _OrderTypeCard(
            title: 'Доставка',
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
    return SizedBox(
      height: tall ? 208 : 100,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
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
                  right: tall ? -34 : 0,
                  bottom: tall ? -8 : -12,
                  child: SizedBox(
                    width: tall ? 178 : 88,
                    height: tall ? 172 : 84,
                    child: Image.asset(
                      illustration.assetPath,
                      fit: BoxFit.contain,
                      filterQuality: FilterQuality.high,
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
                      color: Color(0xFF5A2E1E),
                      size: 28,
                    ),
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
      color: Colors.black,
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
