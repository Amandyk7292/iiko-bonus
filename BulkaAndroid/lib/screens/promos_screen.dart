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
  String _selectedType = 'promotion';
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

  bool _isCurrentlyVisible(PromoStory story) {
    final now = DateTime.now();
    final startsAt = DateTime.tryParse(story.startsAt ?? '')?.toLocal();
    final endsAt = DateTime.tryParse(story.endsAt ?? '')?.toLocal();
    if (startsAt != null && startsAt.isAfter(now)) return false;
    if (endsAt != null && endsAt.isBefore(now)) return false;
    return true;
  }

  Future<void> _open(StoryGroup group) async {
    await _navigationGate.run(() async {
      await showModalBottomSheet<void>(
        context: context,
        useRootNavigator: true,
        isScrollControlled: true,
        backgroundColor: Colors.transparent,
        barrierColor: Colors.black.withValues(alpha: 0.52),
        builder: (sheetContext) => _PromoDetailsSheet(
          group: group,
          onShowQr: (value) => showDialog<void>(
            context: sheetContext,
            useRootNavigator: true,
            builder: (_) =>
                _PromotionQrDialog(title: group.title, value: value),
          ),
        ),
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final groups = _group(
      _stories.where(_isCurrentlyVisible).toList(growable: false),
    );
    final filteredGroups = groups
        .where(
          (group) =>
              group.stories.isNotEmpty &&
              group.stories.first.promoType == _selectedType,
        )
        .toList(growable: false);
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
            ? const _PromoCardsLoading()
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
                child: ScrollConfiguration(
                  key: const ValueKey('promos-scroll-configuration'),
                  behavior: ScrollConfiguration.of(
                    context,
                  ).copyWith(scrollbars: false),
                  child: CustomScrollView(
                    key: const PageStorageKey('promos-list'),
                    physics: const AlwaysScrollableScrollPhysics(),
                    slivers: [
                      SliverToBoxAdapter(
                        child: _PromoTypeTabs(
                          selectedType: _selectedType,
                          onSelected: (value) =>
                              setState(() => _selectedType = value),
                        ),
                      ),
                      if (filteredGroups.isEmpty)
                        SliverFillRemaining(
                          hasScrollBody: false,
                          child: _PromoCategoryEmpty(
                            showRefresh: groups.isEmpty,
                            onRefresh: _load,
                          ),
                        )
                      else
                        SliverPadding(
                          padding: EdgeInsets.fromLTRB(
                            20,
                            8,
                            20,
                            BulkaLayout.bottomNavContentInset(context),
                          ),
                          sliver: SliverLayoutBuilder(
                            builder: (context, constraints) {
                              if (constraints.crossAxisExtent < 720) {
                                return SliverList(
                                  delegate: SliverChildBuilderDelegate(
                                    (context, index) => Padding(
                                      padding: EdgeInsets.only(
                                        bottom:
                                            index == filteredGroups.length - 1
                                            ? 0
                                            : 18,
                                      ),
                                      child: _PromoGridCard(
                                        key: ValueKey(
                                          'promos-grid-card-${filteredGroups[index].id}',
                                        ),
                                        group: filteredGroups[index],
                                        onTap: () =>
                                            _open(filteredGroups[index]),
                                      ),
                                    ),
                                    childCount: filteredGroups.length,
                                  ),
                                );
                              }
                              return SliverGrid(
                                gridDelegate:
                                    const SliverGridDelegateWithFixedCrossAxisCount(
                                      crossAxisCount: 2,
                                      crossAxisSpacing: 18,
                                      mainAxisSpacing: 18,
                                      mainAxisExtent: 500,
                                    ),
                                delegate: SliverChildBuilderDelegate(
                                  (context, index) => _PromoGridCard(
                                    key: ValueKey(
                                      'promos-grid-card-${filteredGroups[index].id}',
                                    ),
                                    group: filteredGroups[index],
                                    onTap: () => _open(filteredGroups[index]),
                                  ),
                                  childCount: filteredGroups.length,
                                ),
                              );
                            },
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

class _PromoGridCard extends StatelessWidget {
  const _PromoGridCard({required this.group, required this.onTap, super.key});

  final StoryGroup group;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final story = group.stories.first;
    final summary = story.localizedDescription?.trim() ?? '';
    final period = _promoPeriodLabel(context, story);
    final published = _promoPublishedLabel(context, story);
    final colors = context.bulkaColors;
    return Semantics(
      button: true,
      label: 'story_open'.trArgs({'title': group.title}),
      child: Material(
        color: Colors.white,
        borderRadius: BorderRadius.circular(BulkaRadii.card),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: DecoratedBox(
            decoration: BoxDecoration(
              border: Border.all(color: colors.cardBorder),
              borderRadius: BorderRadius.circular(BulkaRadii.card),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                AspectRatio(
                  key: ValueKey('promo-cover-${group.id}'),
                  aspectRatio: _promoCoverAspectRatio,
                  child: _NetworkImage(
                    url: group.coverUrl,
                    fit: BoxFit.cover,
                    semanticLabel: group.title,
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 18, 20, 18),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        group.title,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontFamily: _headingFont,
                          color: colors.brandBrown,
                          fontSize: BulkaTypeScale.title,
                          height: 1.2,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      if (summary.isNotEmpty) ...[
                        const SizedBox(height: 8),
                        Text(
                          summary,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            color: colors.mutedText,
                            fontSize: BulkaTypeScale.body,
                            height: 1.38,
                          ),
                        ),
                      ],
                      if (story.remaining != null ||
                          period != null ||
                          published != null) ...[
                        const SizedBox(height: 14),
                        Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: [
                            if (story.remaining != null)
                              _PromoMetadataChip(
                                icon: Icons.inventory_2_outlined,
                                label: 'promos_remaining'.trArgs({
                                  'count': story.remaining,
                                }),
                              ),
                            if (period != null)
                              _PromoMetadataChip(
                                icon: Icons.calendar_today_outlined,
                                label: period,
                              ),
                            if (published != null)
                              _PromoMetadataChip(
                                icon: Icons.schedule_outlined,
                                label: published,
                              ),
                          ],
                        ),
                      ],
                      const SizedBox(height: 16),
                      Align(
                        alignment: Alignment.centerRight,
                        child: TextButton(
                          onPressed: onTap,
                          style: TextButton.styleFrom(
                            minimumSize: const Size(120, 48),
                            padding: const EdgeInsets.symmetric(horizontal: 18),
                            backgroundColor: colors.brandGold,
                            foregroundColor: colors.brandBrown,
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(
                                BulkaRadii.pill,
                              ),
                            ),
                          ),
                          child: Text(
                            'promos_more'.tr,
                            style: const TextStyle(
                              fontFamily: _headingFont,
                              fontSize: BulkaTypeScale.bodySmall,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                      ),
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

class _PromoMetadataChip extends StatelessWidget {
  const _PromoMetadataChip({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
      decoration: BoxDecoration(
        color: colors.surfaceCream,
        borderRadius: BorderRadius.circular(BulkaRadii.pill),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 15, color: colors.brandBrown),
          const SizedBox(width: 6),
          Flexible(
            child: Text(
              label,
              style: TextStyle(
                color: colors.mutedText,
                fontSize: BulkaTypeScale.caption,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _PromoTypeTabs extends StatelessWidget {
  const _PromoTypeTabs({required this.selectedType, required this.onSelected});

  final String selectedType;
  final ValueChanged<String> onSelected;

  static const _types = ['discount', 'promotion', 'subscription'];

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 18),
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: colors.surfaceCream,
          borderRadius: BorderRadius.circular(BulkaRadii.pill),
        ),
        child: Row(
          children: _types
              .map((type) {
                final selected = type == selectedType;
                return Expanded(
                  child: Semantics(
                    button: true,
                    selected: selected,
                    child: InkWell(
                      onTap: () {
                        unawaited(BulkaMotion.selection());
                        onSelected(type);
                      },
                      borderRadius: BorderRadius.circular(BulkaRadii.pill),
                      child: AnimatedContainer(
                        duration: BulkaMotion.fast,
                        curve: Curves.easeOutCubic,
                        constraints: const BoxConstraints(minHeight: 48),
                        alignment: Alignment.center,
                        padding: const EdgeInsets.symmetric(horizontal: 8),
                        decoration: BoxDecoration(
                          color: selected
                              ? colors.brandGold
                              : Colors.transparent,
                          borderRadius: BorderRadius.circular(BulkaRadii.pill),
                        ),
                        child: Text(
                          'promos_tab_$type'.tr,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            fontFamily: _headingFont,
                            color: selected
                                ? colors.brandBrown
                                : colors.mutedText,
                            fontSize: BulkaTypeScale.bodySmall,
                            fontWeight: selected
                                ? FontWeight.w700
                                : FontWeight.w600,
                          ),
                        ),
                      ),
                    ),
                  ),
                );
              })
              .toList(growable: false),
        ),
      ),
    );
  }
}

class _PromoDetailsSheet extends StatelessWidget {
  const _PromoDetailsSheet({required this.group, required this.onShowQr});

  final StoryGroup group;
  final ValueChanged<String> onShowQr;

  @override
  Widget build(BuildContext context) {
    final story = group.stories.first;
    final colors = context.bulkaColors;
    final details = story.localizedLongDescription?.trim().isNotEmpty == true
        ? story.localizedLongDescription!.trim()
        : 'promos_details_fallback'.tr;
    final period = _promoPeriodLabel(context, story);
    final published = _promoPublishedLabel(context, story);
    final qrValue = story.qrValue?.trim() ?? '';
    final maximumHeight = MediaQuery.sizeOf(context).height * 0.92;

    return SafeArea(
      top: false,
      child: Align(
        alignment: Alignment.bottomCenter,
        child: ConstrainedBox(
          constraints: BoxConstraints(maxWidth: 560, maxHeight: maximumHeight),
          child: Material(
            key: const ValueKey('promo-details-sheet'),
            color: Colors.white,
            clipBehavior: Clip.antiAlias,
            borderRadius: const BorderRadius.vertical(
              top: Radius.circular(BulkaRadii.sheet),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(24, 16, 12, 12),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          group.title,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            fontFamily: _headingFont,
                            color: colors.brandBrown,
                            fontSize: BulkaTypeScale.title,
                            fontWeight: FontWeight.w700,
                            height: 1.2,
                          ),
                        ),
                      ),
                      IconButton(
                        onPressed: () => Navigator.of(context).pop(),
                        tooltip: 'close_tooltip'.tr,
                        style: IconButton.styleFrom(
                          minimumSize: const Size(48, 48),
                          backgroundColor: colors.surfaceCream,
                          foregroundColor: colors.brandBrown,
                        ),
                        icon: const Icon(Icons.close_rounded),
                      ),
                    ],
                  ),
                ),
                Flexible(
                  fit: FlexFit.loose,
                  child: SingleChildScrollView(
                    key: const ValueKey('promo-details-scroll'),
                    padding: const EdgeInsets.fromLTRB(24, 8, 24, 24),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        ClipRRect(
                          borderRadius: BorderRadius.circular(BulkaRadii.card),
                          child: AspectRatio(
                            aspectRatio: _promoCoverAspectRatio,
                            child: _NetworkImage(
                              url: group.coverUrl,
                              fit: BoxFit.cover,
                              semanticLabel: group.title,
                            ),
                          ),
                        ),
                        const SizedBox(height: 24),
                        SelectableText(
                          details,
                          style: TextStyle(
                            color: colors.brandBrown,
                            fontSize: BulkaTypeScale.body,
                            height: 1.55,
                          ),
                        ),
                        if (story.remaining != null ||
                            period != null ||
                            published != null) ...[
                          const SizedBox(height: 22),
                          Wrap(
                            spacing: 8,
                            runSpacing: 8,
                            children: [
                              if (story.remaining != null)
                                _PromoMetadataChip(
                                  icon: Icons.inventory_2_outlined,
                                  label: 'promos_remaining'.trArgs({
                                    'count': story.remaining,
                                  }),
                                ),
                              if (period != null)
                                _PromoMetadataChip(
                                  icon: Icons.calendar_today_outlined,
                                  label: period,
                                ),
                              if (published != null)
                                _PromoMetadataChip(
                                  icon: Icons.schedule_outlined,
                                  label: published,
                                ),
                            ],
                          ),
                        ],
                        if (qrValue.isNotEmpty) ...[
                          const SizedBox(height: 28),
                          SizedBox(
                            width: double.infinity,
                            child: ElevatedButton.icon(
                              onPressed: () => onShowQr(qrValue),
                              icon: const Icon(Icons.qr_code_2_rounded),
                              label: Text('promos_show_qr'.tr),
                              style: ElevatedButton.styleFrom(
                                minimumSize: const Size.fromHeight(52),
                                backgroundColor: colors.brandGold,
                                foregroundColor: colors.brandBrown,
                                elevation: 0,
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(
                                    BulkaRadii.pill,
                                  ),
                                ),
                                textStyle: const TextStyle(
                                  fontFamily: _headingFont,
                                  fontSize: BulkaTypeScale.body,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ),
                          ),
                        ],
                      ],
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

class _PromotionQrDialog extends StatelessWidget {
  const _PromotionQrDialog({required this.title, required this.value});

  final String title;
  final String value;

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    return Dialog(
      insetPadding: const EdgeInsets.all(24),
      backgroundColor: Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(BulkaRadii.sheet),
      ),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 360),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 16, 24, 28),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      'promos_qr_title'.tr,
                      style: TextStyle(
                        fontFamily: _headingFont,
                        color: colors.brandBrown,
                        fontSize: BulkaTypeScale.title,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  IconButton(
                    onPressed: () => Navigator.of(context).pop(),
                    tooltip: 'close_tooltip'.tr,
                    icon: const Icon(Icons.close_rounded),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Semantics(
                image: true,
                label: '${'promos_qr_title'.tr}: $title',
                child: Container(
                  width: 240,
                  height: 240,
                  padding: const EdgeInsets.all(14),
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: Colors.white,
                    border: Border.all(color: colors.cardBorder),
                    borderRadius: BorderRadius.circular(BulkaRadii.card),
                  ),
                  child: QrImageView(
                    key: const ValueKey('promotion-qr'),
                    data: value,
                    backgroundColor: Colors.white,
                    errorCorrectionLevel: QrErrorCorrectLevel.H,
                    eyeStyle: QrEyeStyle(
                      eyeShape: QrEyeShape.square,
                      color: colors.brandBrown,
                    ),
                    dataModuleStyle: QrDataModuleStyle(
                      dataModuleShape: QrDataModuleShape.circle,
                      color: colors.brandBrown,
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 16),
              Text(
                title,
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: colors.brandBrown,
                  fontSize: BulkaTypeScale.body,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _PromoCategoryEmpty extends StatelessWidget {
  const _PromoCategoryEmpty({
    required this.showRefresh,
    required this.onRefresh,
  });

  final bool showRefresh;
  final Future<void> Function({bool silent}) onRefresh;

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.local_offer_outlined, size: 48, color: colors.brandGold),
            const SizedBox(height: 14),
            Text(
              showRefresh ? 'promos_empty'.tr : 'promos_category_empty'.tr,
              textAlign: TextAlign.center,
              style: TextStyle(
                fontFamily: _headingFont,
                color: colors.brandBrown,
                fontSize: BulkaTypeScale.title,
                fontWeight: FontWeight.w700,
              ),
            ),
            if (showRefresh) ...[
              const SizedBox(height: 18),
              OutlinedButton(
                onPressed: () => unawaited(onRefresh()),
                child: Text('refresh_btn'.tr),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _PromoCardsLoading extends StatelessWidget {
  const _PromoCardsLoading();

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    return ListView.separated(
      physics: const NeverScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(20, 76, 20, 20),
      itemCount: 2,
      separatorBuilder: (_, _) => const SizedBox(height: 18),
      itemBuilder: (_, index) => Container(
        height: 340,
        decoration: BoxDecoration(
          color: colors.surfaceCream,
          borderRadius: BorderRadius.circular(BulkaRadii.card),
          border: Border.all(color: colors.cardBorder),
        ),
        clipBehavior: Clip.antiAlias,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            AspectRatio(
              aspectRatio: _promoCoverAspectRatio,
              child: ColoredBox(color: colors.skeletonBase),
            ),
            Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    height: 18,
                    width: 180,
                    decoration: BoxDecoration(
                      color: colors.skeletonBase,
                      borderRadius: BorderRadius.circular(BulkaRadii.small),
                    ),
                  ),
                  const SizedBox(height: 12),
                  Container(
                    height: 14,
                    width: double.infinity,
                    decoration: BoxDecoration(
                      color: colors.skeletonHighlight,
                      borderRadius: BorderRadius.circular(BulkaRadii.small),
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

String? _promoPeriodLabel(BuildContext context, PromoStory story) {
  final startsAt = DateTime.tryParse(story.startsAt ?? '')?.toLocal();
  final endsAt = DateTime.tryParse(story.endsAt ?? '')?.toLocal();
  if (startsAt != null && endsAt != null) {
    return 'promos_period'.trArgs({
      'from': formatUiDate(context, startsAt),
      'to': formatUiDate(context, endsAt),
    });
  }
  if (startsAt != null) {
    return 'promos_from_date'.trArgs({'date': formatUiDate(context, startsAt)});
  }
  if (endsAt != null) {
    return 'promos_until_date'.trArgs({'date': formatUiDate(context, endsAt)});
  }
  return null;
}

String? _promoPublishedLabel(BuildContext context, PromoStory story) {
  final createdAt = DateTime.tryParse(story.createdAt ?? '')?.toLocal();
  if (createdAt == null) return null;
  return 'promos_published'.trArgs({'date': formatUiDate(context, createdAt)});
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
