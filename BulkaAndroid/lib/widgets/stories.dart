part of '../main.dart';

const _promoCoverAspectRatio = 1080 / 480;
const _promoMobileMaxWidth = 520.0;

class StoryGroup {
  const StoryGroup({
    required this.id,
    required this.title,
    required this.coverUrl,
    required this.stories,
    this.subtitle,
  });

  final String id;
  final String title;
  final String coverUrl;
  final List<PromoStory> stories;
  final String? subtitle;
}

class PromoBannerShimmer extends StatefulWidget {
  const PromoBannerShimmer({super.key});

  @override
  State<PromoBannerShimmer> createState() => _PromoBannerShimmerState();
}

class _PromoBannerShimmerState extends State<PromoBannerShimmer>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  bool _reduceMotion = false;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1400),
    );
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final reduceMotion = BulkaMotion.reduced(context);
    if (reduceMotion == _reduceMotion && _controller.isAnimating) return;
    _reduceMotion = reduceMotion;
    if (_reduceMotion) {
      _controller.stop();
      _controller.value = 0.5;
    } else if (!_controller.isAnimating) {
      _controller.repeat();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final shimmer = _reduceMotion ? null : _controller;
    return LayoutBuilder(
      builder: (context, constraints) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16),
        child: constraints.maxWidth >= 720
            ? Row(
                children: [
                  Expanded(child: _buildCard(shimmer)),
                  const SizedBox(width: 18),
                  Expanded(child: _buildCard(shimmer)),
                ],
              )
            : Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(
                    maxWidth: _promoMobileMaxWidth,
                  ),
                  child: _buildCard(shimmer),
                ),
              ),
      ),
    );
  }

  Widget _buildCard(Animation<double>? animation) {
    final colors = context.bulkaColors;
    final content = Padding(
      padding: const EdgeInsets.all(22),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          _skeletonLine(180, 22, 8, const Color(0xFFE8E3DA)),
          const SizedBox(height: 12),
          _skeletonLine(240, 14, 6, colors.skeletonBase),
          const SizedBox(height: 8),
          _skeletonLine(140, 14, 6, colors.skeletonBase),
        ],
      ),
    );

    Widget decorated(double value, Widget child) => DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(BulkaRadii.card),
        border: Border.all(
          color: const Color(0xFF6D3317).withValues(alpha: 0.10),
        ),
        gradient: LinearGradient(
          begin: Alignment(-2.0 + 4.0 * value, -0.5),
          end: Alignment(-1.0 + 4.0 * value, 0.5),
          colors: const [
            Color(0xFFFFFFFF),
            Color(0xFFFAFAF7),
            Color(0xFFFFE8C2),
            Color(0xFFFAFAF7),
            Color(0xFFFFFFFF),
          ],
          stops: const [0.0, 0.35, 0.5, 0.65, 1.0],
        ),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0C000000),
            blurRadius: 16,
            offset: Offset(0, 4),
          ),
        ],
      ),
      child: child,
    );

    return AspectRatio(
      aspectRatio: _promoCoverAspectRatio,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(BulkaRadii.card),
        clipBehavior: Clip.antiAlias,
        child: animation == null
            ? decorated(0.5, content)
            : AnimatedBuilder(
                animation: animation,
                child: content,
                builder: (context, child) => decorated(animation.value, child!),
              ),
      ),
    );
  }

  Widget _skeletonLine(
    double width,
    double height,
    double radius,
    Color color,
  ) {
    return Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(radius),
      ),
    );
  }
}

class PromoBannerSlider extends StatefulWidget {
  const PromoBannerSlider({
    required this.groups,
    required this.onGroupTap,
    super.key,
  });

  final List<StoryGroup> groups;
  final ValueChanged<StoryGroup> onGroupTap;

  @override
  State<PromoBannerSlider> createState() => _PromoBannerSliderState();
}

class _PromoBannerSliderState extends State<PromoBannerSlider> {
  late final PageController _pageController;
  int _currentIndex = 0;
  Timer? _timer;
  bool _reduceMotion = false;
  bool _tickerEnabled = true;
  bool _dependenciesReady = false;

  @override
  void initState() {
    super.initState();
    _pageController = PageController();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final reduceMotion = BulkaMotion.reduced(context);
    final tickerEnabled = TickerMode.of(context);
    if (!_dependenciesReady ||
        reduceMotion != _reduceMotion ||
        tickerEnabled != _tickerEnabled) {
      _dependenciesReady = true;
      _reduceMotion = reduceMotion;
      _tickerEnabled = tickerEnabled;
      _startTimer();
    }
  }

  void _startTimer() {
    _timer?.cancel();
    if (!_reduceMotion && _tickerEnabled && widget.groups.length > 1) {
      _timer = Timer(const Duration(seconds: 5), () {
        if (!mounted || !_pageController.hasClients) return;
        final next = (_currentIndex + 1) % widget.groups.length;
        unawaited(
          _pageController.animateToPage(
            next,
            // A balanced ease-in/ease-out avoids the abrupt first frames of
            // the standard entrance curve and keeps the banner readable
            // while it glides to the next promotion.
            duration: const Duration(milliseconds: 720),
            curve: Curves.easeInOutCubic,
          ),
        );
      });
    }
  }

  void _handlePageChanged(int index) {
    if (!mounted) return;
    setState(() => _currentIndex = index);
    _startTimer();
  }

  @override
  void didUpdateWidget(covariant PromoBannerSlider oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.groups.length != widget.groups.length) {
      _startTimer();
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    _pageController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (widget.groups.isEmpty) return const SizedBox.shrink();

    return LayoutBuilder(
      builder: (context, constraints) {
        final fallbackHeight =
            widget.groups.any((group) => !group.coverUrl.startsWith('http'))
            ? 44 +
                  MediaQuery.textScalerOf(
                    context,
                  ).scale(BulkaTypeScale.title + BulkaTypeScale.bodySmall * 2.5)
            : 0.0;
        if (constraints.maxWidth >= 720) {
          final gridWidth = constraints.maxWidth - 48;
          final cardWidth = (gridWidth - 18) / 2;
          return GridView.builder(
            clipBehavior: Clip.none,
            padding: const EdgeInsets.symmetric(horizontal: 24),
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: 2,
              crossAxisSpacing: 18,
              mainAxisSpacing: 18,
              mainAxisExtent: max(
                cardWidth / _promoCoverAspectRatio,
                fallbackHeight,
              ),
            ),
            itemCount: widget.groups.length,
            itemBuilder: (context, index) => _PromoBannerCard(
              group: widget.groups[index],
              onTap: () => widget.onGroupTap(widget.groups[index]),
            ),
          );
        }

        return Column(
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 8),
              child: Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(
                    maxWidth: _promoMobileMaxWidth + 16,
                  ),
                  child: SizedBox(
                    height: max(
                      min(constraints.maxWidth - 32, _promoMobileMaxWidth) /
                          _promoCoverAspectRatio,
                      fallbackHeight,
                    ),
                    child: PageView.builder(
                      clipBehavior: Clip.none,
                      controller: _pageController,
                      itemCount: widget.groups.length,
                      onPageChanged: _handlePageChanged,
                      itemBuilder: (context, idx) => Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 8),
                        child: _PromoBannerCard(
                          group: widget.groups[idx],
                          onTap: () => widget.onGroupTap(widget.groups[idx]),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
            if (widget.groups.length > 1) ...[
              const SizedBox(height: 10),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: List.generate(widget.groups.length, (idx) {
                  final active = idx == _currentIndex;
                  return AnimatedContainer(
                    duration: BulkaMotion.duration(
                      context,
                      BulkaMotion.standard,
                    ),
                    margin: const EdgeInsets.symmetric(horizontal: 3),
                    width: active ? 20 : 6,
                    height: 5,
                    decoration: BoxDecoration(
                      color: active
                          ? const Color(0xFFFFB300)
                          : const Color(0xFFE4D3BA),
                      borderRadius: BorderRadius.circular(BulkaRadii.small),
                    ),
                  );
                }),
              ),
            ],
          ],
        );
      },
    );
  }
}

class _PromoBannerCard extends StatelessWidget {
  const _PromoBannerCard({required this.group, required this.onTap});

  final StoryGroup group;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: 'story_open'.trArgs({'title': group.title}),
      child: BulkaHero(
        tag: 'promo-${group.id}',
        child: BulkaPressScale(
          child: Material(
            color: Colors.transparent,
            child: InkWell(
              key: ValueKey('promo-card-${group.id}'),
              onTap: () {
                BulkaMotion.lightImpact();
                onTap();
              },
              borderRadius: BorderRadius.circular(BulkaRadii.control),
              child: AnimatedContainer(
                duration: BulkaMotion.duration(context, BulkaMotion.fast),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(BulkaRadii.control),
                  boxShadow: BulkaShadows.card,
                ),
                foregroundDecoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(BulkaRadii.control),
                  border: Border.all(
                    color: const Color(0xFFE0B858),
                    width: 1.8,
                  ),
                ),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(BulkaRadii.control),
                  child: _BannerFullCoverWidget(group: group),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _BannerFullCoverWidget extends StatelessWidget {
  const _BannerFullCoverWidget({required this.group});

  final StoryGroup group;

  @override
  Widget build(BuildContext context) {
    if (group.coverUrl.startsWith('http')) {
      return _NetworkImage(
        key: ValueKey('promo-image-${group.id}'),
        url: group.coverUrl,
        fit: BoxFit.cover,
      );
    }
    return Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF4A2210), Color(0xFF231007)],
        ),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(
                  group.title.toUpperCase(),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontFamily: _headingFont,
                    fontSize: BulkaTypeScale.title,
                    fontWeight: FontWeight.w700,
                    color: Color(0xFFEADBBE),
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  group.subtitle ?? 'story_offer_fallback'.tr,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: BulkaTypeScale.bodySmall,
                    color: Colors.white70,
                    height: 1.25,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
