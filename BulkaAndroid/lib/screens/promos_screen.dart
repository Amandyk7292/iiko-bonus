part of '../main.dart';

class PromosScreen extends StatefulWidget {
  const PromosScreen({required this.api, super.key});

  final BulkaApiClient api;

  @override
  State<PromosScreen> createState() => _PromosScreenState();
}

class _PromosScreenState extends State<PromosScreen>
    with WidgetsBindingObserver {
  List<PromoStory> _stories = const [];
  Timer? _refreshTimer;
  bool _loading = true;
  bool _refreshing = false;
  bool _loadFailed = false;
  final _navigationGate = _AsyncActionGate();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(_load());
    _refreshTimer = Timer.periodic(
      const Duration(minutes: 1),
      (_) => unawaited(_load(silent: true)),
    );
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _refreshTimer?.cancel();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) unawaited(_load(silent: true));
  }

  Future<void> _load({bool silent = false}) async {
    if (_refreshing) return;
    _refreshing = true;
    if (!silent && mounted) {
      setState(() {
        _loading = true;
        _loadFailed = false;
      });
    }
    try {
      final stories = await widget.api.getStories();
      if (!mounted) return;
      setState(() {
        _stories = stories;
        _loading = false;
        _loadFailed = false;
      });
    } catch (_) {
      if (!mounted || silent) return;
      setState(() {
        _loading = false;
        _loadFailed = true;
      });
    } finally {
      _refreshing = false;
    }
  }

  List<StoryGroup> _group(List<PromoStory> stories) {
    final grouped = <String, List<PromoStory>>{};
    for (final story in stories) {
      grouped.putIfAbsent(story.groupId, () => []).add(story);
    }
    return grouped.entries.map((entry) {
      final items = [...entry.value]
        ..sort((a, b) {
          final byOrder = a.sortOrder.compareTo(b.sortOrder);
          return byOrder == 0 ? a.id.compareTo(b.id) : byOrder;
        });
      final first = items.first;
      return StoryGroup(
        id: entry.key,
        title: first.localizedGroupTitle.isEmpty
            ? first.localizedTitle
            : first.localizedGroupTitle,
        subtitle: first.localizedDescription,
        coverUrl: first.localizedGroupCoverUrl.isEmpty
            ? first.localizedImageUrl
            : first.localizedGroupCoverUrl,
        stories: items,
      );
    }).toList()..sort(
      (a, b) => a.stories.first.sortOrder.compareTo(b.stories.first.sortOrder),
    );
  }

  Future<void> _open(StoryGroup group) async {
    await _navigationGate.run(() async {
      final sequence = _group(
        _stories,
      ).expand((item) => item.stories).toList(growable: false);
      if (sequence.isEmpty) return;
      final matchedIndex = sequence.indexWhere(
        (story) => story.id == group.stories.first.id,
      );
      await Navigator.of(context).push<void>(
        MaterialPageRoute(
          settings: RouteSettings(name: 'promo-${group.id}'),
          builder: (_) => StoryViewer(
            stories: sequence,
            initialIndex: matchedIndex < 0 ? 0 : matchedIndex,
            heroTag: 'promos-${group.id}',
          ),
        ),
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final groups = _group(_stories);
    return Scaffold(
      backgroundColor: scheme.surface,
      appBar: AppBar(
        toolbarHeight: BulkaLayout.appBarHeight(context),
        automaticallyImplyLeading: false,
        centerTitle: true,
        backgroundColor: scheme.surface,
        title: _BulkaPageTitle('nav_promos'.tr),
      ),
      body: SafeArea(
        top: false,
        child: _loading
            ? const Center(child: CircularProgressIndicator())
            : _loadFailed
            ? _PromosState(
                icon: Icons.cloud_off_outlined,
                title: 'promos_load_failed'.tr,
                actionLabel: 'retry_btn'.tr,
                onAction: _load,
              )
            : groups.isEmpty
            ? _PromosState(
                icon: Icons.local_offer_outlined,
                title: 'promos_empty'.tr,
                actionLabel: 'refresh_btn'.tr,
                onAction: _load,
              )
            : RefreshIndicator(
                onRefresh: _load,
                color: _caramel,
                child: LayoutBuilder(
                  builder: (context, constraints) {
                    final columns = constraints.maxWidth >= 620 ? 2 : 1;
                    return GridView.builder(
                      key: const PageStorageKey('promos-grid'),
                      physics: const AlwaysScrollableScrollPhysics(),
                      padding: EdgeInsets.fromLTRB(
                        20,
                        20,
                        20,
                        BulkaLayout.bottomNavContentInset(context),
                      ),
                      gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                        crossAxisCount: columns,
                        crossAxisSpacing: 16,
                        mainAxisSpacing: 16,
                        childAspectRatio: 1080 / 480,
                      ),
                      itemCount: groups.length,
                      itemBuilder: (context, index) {
                        final group = groups[index];
                        return _PromoGridCard(
                          key: ValueKey('promos-grid-card-${group.id}'),
                          group: group,
                          onTap: () => _open(group),
                        );
                      },
                    );
                  },
                ),
              ),
      ),
    );
  }
}

class _PromoGridCard extends StatelessWidget {
  const _PromoGridCard({required this.group, required this.onTap, super.key});

  final StoryGroup group;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: 'story_open'.trArgs({'title': group.title}),
      child: Material(
        color: Colors.white,
        borderRadius: BorderRadius.circular(BulkaRadii.card),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Stack(
            fit: StackFit.expand,
            children: [
              _NetworkImage(
                url: group.coverUrl,
                fit: BoxFit.cover,
                semanticLabel: group.title,
              ),
              DecoratedBox(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    colors: [
                      Colors.transparent,
                      _cocoa.withValues(alpha: 0.82),
                    ],
                  ),
                ),
              ),
              Positioned(
                left: 18,
                right: 18,
                bottom: 16,
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Expanded(
                      child: Text(
                        group.title,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontFamily: _headingFont,
                          color: Colors.white,
                          fontSize: BulkaTypeScale.title,
                          height: 1.12,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                    const SizedBox(width: 12),
                    const Icon(
                      Icons.arrow_forward_rounded,
                      color: Colors.white,
                      size: 24,
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _PromosState extends StatelessWidget {
  const _PromosState({
    required this.icon,
    required this.title,
    required this.actionLabel,
    required this.onAction,
  });

  final IconData icon;
  final String title;
  final String actionLabel;
  final Future<void> Function({bool silent}) onAction;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 48, color: _caramel),
            const SizedBox(height: 16),
            Text(
              title,
              textAlign: TextAlign.center,
              style: TextStyle(
                fontFamily: _headingFont,
                color: Theme.of(context).colorScheme.onSurface,
                fontSize: BulkaTypeScale.title,
              ),
            ),
            const SizedBox(height: 20),
            OutlinedButton(
              onPressed: () => unawaited(onAction()),
              child: Text(actionLabel),
            ),
          ],
        ),
      ),
    );
  }
}
