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
    required this.viewedGroups,
    required this.onGroupTap,
    super.key,
  });

  final List<StoryGroup> groups;
  final Set<String> viewedGroups;
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
            duration: BulkaMotion.emphasized,
            curve: BulkaMotion.enterCurve,
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
        if (constraints.maxWidth >= 720) {
          final gridWidth = constraints.maxWidth - 48;
          final cardWidth = (gridWidth - 18) / 2;
          return GridView.builder(
            padding: const EdgeInsets.symmetric(horizontal: 24),
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: 2,
              crossAxisSpacing: 18,
              mainAxisSpacing: 18,
              mainAxisExtent: cardWidth / _promoCoverAspectRatio,
            ),
            itemCount: widget.groups.length,
            itemBuilder: (context, index) => _PromoBannerCard(
              group: widget.groups[index],
              viewed: widget.viewedGroups.contains(widget.groups[index].id),
              onTap: () => widget.onGroupTap(widget.groups[index]),
            ),
          );
        }

        return Column(
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(
                    maxWidth: _promoMobileMaxWidth,
                  ),
                  child: AspectRatio(
                    aspectRatio: _promoCoverAspectRatio,
                    child: PageView.builder(
                      controller: _pageController,
                      itemCount: widget.groups.length,
                      onPageChanged: _handlePageChanged,
                      itemBuilder: (context, idx) => _PromoBannerCard(
                        group: widget.groups[idx],
                        viewed: widget.viewedGroups.contains(
                          widget.groups[idx].id,
                        ),
                        onTap: () => widget.onGroupTap(widget.groups[idx]),
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
  const _PromoBannerCard({
    required this.group,
    required this.viewed,
    required this.onTap,
  });

  final StoryGroup group;
  final bool viewed;
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
                  border: Border.all(
                    color: viewed
                        ? const Color(0xFFEADBBE).withValues(alpha: 0.62)
                        : const Color(0xFFE0B858),
                    width: viewed ? 1.2 : 1.8,
                  ),
                  boxShadow: [
                    BoxShadow(
                      color: const Color(0xFF6D3317).withValues(alpha: 0.10),
                      blurRadius: 16,
                      offset: const Offset(0, 6),
                    ),
                  ],
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
      return _NetworkImage(url: group.coverUrl, fit: BoxFit.contain);
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

class PromoModalViewer extends StatelessWidget {
  const PromoModalViewer({required this.group, super.key});

  final StoryGroup group;

  @override
  Widget build(BuildContext context) {
    final story = group.stories.isNotEmpty ? group.stories.first : null;
    final title = group.title;
    final subtitle =
        group.subtitle ??
        story?.localizedDescription ??
        story?.localizedTitle ??
        'story_offer_fallback'.tr;
    final isHappy = group.id == 'happy_hours' || title.contains('2+1');

    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
              child: Stack(
                alignment: Alignment.center,
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 18,
                      vertical: 7,
                    ),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(BulkaRadii.control),
                      border: Border.all(color: const Color(0xFFEADBBE)),
                      boxShadow: [
                        BoxShadow(
                          color: const Color(
                            0xFF6D3317,
                          ).withValues(alpha: 0.05),
                          blurRadius: 8,
                          offset: const Offset(0, 2),
                        ),
                      ],
                    ),
                    child: const Text(
                      'Bulka Cafe & Bakery',
                      style: TextStyle(
                        fontFamily: _headingFont,
                        fontSize: BulkaTypeScale.bodySmall,
                        fontWeight: FontWeight.w700,
                        color: Color(0xFF5A2A18),
                      ),
                    ),
                  ),
                  Align(
                    alignment: Alignment.centerRight,
                    child: IconButton(
                      onPressed: () => Navigator.of(context).maybePop(),
                      tooltip: 'close_tooltip'.tr,
                      icon: const Icon(
                        Icons.close,
                        color: Color(0xFF5A2A18),
                        size: 26,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.symmetric(
                  horizontal: 28,
                  vertical: 16,
                ),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const SizedBox(height: 12),
                    Text(
                      title.toUpperCase(),
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        fontFamily: _headingFont,
                        fontSize: BulkaTypeScale.titleLarge,
                        fontWeight: FontWeight.w700,
                        color: Color(0xFF4A2210),
                        height: 1.15,
                      ),
                    ),
                    const SizedBox(height: 12),
                    Text(
                      subtitle,
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        fontSize: BulkaTypeScale.body,
                        color: Color(0xFF7D5034),
                        height: 1.35,
                      ),
                    ),
                    const SizedBox(height: 32),
                    Container(
                      height: 220,
                      width: double.infinity,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: const Color(0xFFFFFBF4),
                        borderRadius: BorderRadius.circular(BulkaRadii.card),
                        border: Border.all(
                          color: const Color(0xFFEADBBE),
                          width: 1.2,
                        ),
                      ),
                      child:
                          (story != null &&
                              story.localizedContentUrl.startsWith('http'))
                          ? ClipRRect(
                              borderRadius: BorderRadius.circular(
                                BulkaRadii.card,
                              ),
                              child: _NetworkImage(
                                url: story.localizedContentUrl,
                                fit: BoxFit.cover,
                              ),
                            )
                          : Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Text(
                                  isHappy ? '2 + 1' : 'story_gift'.tr,
                                  style: TextStyle(
                                    fontFamily: _headingFont,
                                    fontSize: isHappy ? 64 : 68,
                                    fontWeight: FontWeight.w700,
                                    color: const Color(0xFFD38B28),
                                  ),
                                ),
                                const SizedBox(height: 8),
                                Text(
                                  subtitle,
                                  style: const TextStyle(
                                    fontFamily: _headingFont,
                                    fontSize: BulkaTypeScale.bodySmall,
                                    fontWeight: FontWeight.w700,
                                    color: Color(0xFF8B5E3C),
                                  ),
                                ),
                              ],
                            ),
                    ),
                  ],
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(28, 0, 28, 20),
              child: Column(
                children: [
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton(
                      onPressed: () => Navigator.of(context).push<void>(
                        MaterialPageRoute(
                          builder: (_) => const LocationsScreen(),
                        ),
                      ),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFFDCAE68),
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.symmetric(vertical: 16),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(BulkaRadii.card),
                        ),
                        elevation: 0,
                      ),
                      child: Text(
                        'catalog_action'.tr,
                        style: const TextStyle(
                          fontFamily: _headingFont,
                          fontSize: BulkaTypeScale.body,
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
    );
  }
}

const _desktopStoryBreakpoint = 900.0;
const _desktopStoryMaxWidth = 540.0;
const _desktopStoryMaxHeight = 960.0;
const _storyPortraitAspectRatio = 9 / 16;

bool _usesDesktopStoryLayout(Size viewport) =>
    viewport.width >= _desktopStoryBreakpoint;

Size _storyRenderSize(Size viewport) {
  if (!_usesDesktopStoryLayout(viewport)) return viewport;
  final availableWidth = max(
    1.0,
    min(_desktopStoryMaxWidth, viewport.width - 160),
  );
  final availableHeight = max(
    1.0,
    min(_desktopStoryMaxHeight, viewport.height - 32),
  );
  final width = min(
    availableWidth,
    availableHeight * _storyPortraitAspectRatio,
  );
  return Size(width, width / _storyPortraitAspectRatio);
}

class _DesktopStoryViewport extends StatelessWidget {
  const _DesktopStoryViewport({
    required this.story,
    required this.onDismiss,
    required this.child,
  });

  final PromoStory story;
  final VoidCallback onDismiss;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final frameSize = _storyRenderSize(constraints.biggest);
        const radius = BorderRadius.all(Radius.circular(26));
        return Stack(
          fit: StackFit.expand,
          children: [
            Semantics(
              button: true,
              label: 'close_tooltip'.tr,
              child: GestureDetector(
                behavior: HitTestBehavior.opaque,
                onTap: onDismiss,
                child: _DesktopStoryBackdrop(story: story),
              ),
            ),
            Center(
              child: SizedBox(
                key: const ValueKey('story-desktop-frame'),
                width: frameSize.width,
                height: frameSize.height,
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    color: Colors.black,
                    borderRadius: radius,
                    border: Border.all(
                      color: Colors.white.withValues(alpha: 0.16),
                    ),
                    boxShadow: const [
                      BoxShadow(
                        color: Color(0x990F0704),
                        blurRadius: 48,
                        spreadRadius: 2,
                        offset: Offset(0, 18),
                      ),
                    ],
                  ),
                  child: Padding(
                    padding: const EdgeInsets.all(1),
                    child: ClipRRect(
                      borderRadius: const BorderRadius.all(Radius.circular(25)),
                      child: child,
                    ),
                  ),
                ),
              ),
            ),
          ],
        );
      },
    );
  }
}

class _DesktopStoryBackdrop extends StatelessWidget {
  const _DesktopStoryBackdrop({required this.story});

  final PromoStory story;

  @override
  Widget build(BuildContext context) {
    final url = _storyImageUrl(story);
    return ExcludeSemantics(
      child: Stack(
        key: const ValueKey('story-desktop-backdrop'),
        fit: StackFit.expand,
        children: [
          const ColoredBox(color: Color(0xFF1B0D08)),
          if (url.startsWith('http'))
            Opacity(
              opacity: 0.24,
              child: ImageFiltered(
                imageFilter: ui.ImageFilter.blur(sigmaX: 32, sigmaY: 32),
                child: Transform.scale(
                  scale: 1.08,
                  child: _NetworkImage(
                    url: url,
                    fit: BoxFit.cover,
                    loadingPlaceholder: const SizedBox.expand(),
                    errorPlaceholder: const SizedBox.expand(),
                  ),
                ),
              ),
            ),
          const DecoratedBox(
            decoration: BoxDecoration(
              gradient: RadialGradient(
                radius: 1.05,
                colors: [Color(0x221F1009), Color(0xE6140906)],
                stops: [0.18, 1],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class StoryViewer extends StatefulWidget {
  const StoryViewer({
    required this.stories,
    required this.initialIndex,
    required this.heroTag,
    super.key,
  });

  final List<PromoStory> stories;
  final int initialIndex;
  final Object heroTag;

  @override
  State<StoryViewer> createState() => _StoryViewerState();
}

class _StoryViewerState extends State<StoryViewer>
    with TickerProviderStateMixin {
  late int _index;
  late AnimationController _progressController;
  late AnimationController _transitionController;
  int? _targetIndex;
  bool _forward = true;
  bool _reduceMotion = false;
  bool _dependenciesReady = false;
  bool _interactiveTransition = false;
  double _horizontalDragExtent = 0;
  bool _verticalDragging = false;
  double _verticalDragOffset = 0;

  @override
  void initState() {
    super.initState();
    _index = widget.initialIndex;
    _progressController = AnimationController(vsync: this)
      ..addStatusListener((status) {
        if (status == AnimationStatus.completed) _next();
      });
    _transitionController = AnimationController(
      vsync: this,
      duration: BulkaMotion.emphasized,
    );
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final reduceMotion = BulkaMotion.reduced(context);
    if (!_dependenciesReady || reduceMotion != _reduceMotion) {
      _dependenciesReady = true;
      _reduceMotion = reduceMotion;
      if (_reduceMotion) {
        _progressController
          ..stop()
          ..value = 0;
        _transitionController
          ..stop()
          ..value = 1;
      } else {
        _transitionController.value = 0;
        _play();
      }
      _precacheNeighbors();
    }
  }

  @override
  void dispose() {
    _progressController.dispose();
    _transitionController.dispose();
    super.dispose();
  }

  void _play() {
    if (_reduceMotion) {
      _progressController
        ..stop()
        ..value = 0;
      return;
    }
    final durationSec = widget.stories[_index].duration > 0
        ? widget.stories[_index].duration
        : 15;
    final duration = Duration(seconds: durationSec);
    _progressController
      ..duration = duration
      ..reset()
      ..forward();
  }

  void _precacheNeighbors() {
    final media = MediaQuery.of(context);
    final renderSize = _storyRenderSize(media.size);
    final pixelWidth = _imagePixelBucket(
      renderSize.width * media.devicePixelRatio,
    );
    final pixelHeight = _imagePixelBucket(
      renderSize.height * media.devicePixelRatio,
    );
    final indexes = <int>{
      _index,
      if (_index > 0) _index - 1,
      if (_index < widget.stories.length - 1) _index + 1,
    };
    for (final index in indexes) {
      final url = _storyImageUrl(widget.stories[index]);
      if (!url.startsWith('http')) continue;
      final effectiveUrl = optimizedNetworkImageUrl(
        url,
        pixelWidth: pixelWidth,
        pixelHeight: pixelHeight,
        resizeMode: 'cover',
      );
      unawaited(
        precacheImage(NetworkImage(effectiveUrl), context, onError: (_, _) {}),
      );
    }
  }

  void _next() {
    if (_transitionController.isAnimating) return;
    if (_index < widget.stories.length - 1) {
      _goTo(_index + 1, forward: true);
    } else {
      Navigator.of(context).maybePop();
    }
  }

  void _previous() {
    if (_transitionController.isAnimating) return;
    if (_index > 0) {
      _goTo(_index - 1, forward: false);
    } else {
      Navigator.of(context).maybePop();
    }
  }

  Future<void> _goTo(int nextIndex, {required bool forward}) async {
    _progressController.stop();
    BulkaMotion.selection();
    if (BulkaMotion.reduced(context)) {
      setState(() {
        _index = nextIndex;
        _targetIndex = null;
      });
      _play();
      _precacheNeighbors();
      return;
    }
    setState(() {
      _targetIndex = nextIndex;
      _forward = forward;
    });
    await _transitionController.forward(from: 0);
    if (!mounted) return;
    setState(() {
      _index = nextIndex;
      _targetIndex = null;
    });
    _transitionController.reset();
    _play();
    _precacheNeighbors();
  }

  void _handleHorizontalDragStart(DragStartDetails details) {
    if (_transitionController.isAnimating || _verticalDragging) return;
    _progressController.stop();
    _horizontalDragExtent = 0;
    _interactiveTransition = true;
  }

  void _handleHorizontalDragUpdate(DragUpdateDetails details) {
    if (!_interactiveTransition) return;
    _horizontalDragExtent += details.delta.dx;
    final forward = _horizontalDragExtent < 0;
    final targetIndex = forward ? _index + 1 : _index - 1;
    if (targetIndex < 0 || targetIndex >= widget.stories.length) {
      if (_targetIndex != null) setState(() => _targetIndex = null);
      _transitionController.value = 0;
      return;
    }
    if (_targetIndex != targetIndex || _forward != forward) {
      setState(() {
        _targetIndex = targetIndex;
        _forward = forward;
      });
    }
    final width = _storyRenderSize(
      MediaQuery.sizeOf(context),
    ).width.clamp(1.0, double.infinity);
    _transitionController.value = (_horizontalDragExtent.abs() / width).clamp(
      0.0,
      1.0,
    );
  }

  void _handleHorizontalDragEnd(DragEndDetails details) {
    if (!_interactiveTransition) return;
    _interactiveTransition = false;
    final targetIndex = _targetIndex;
    if (targetIndex == null) {
      _transitionController.reset();
      _play();
      return;
    }
    final velocity = details.velocity.pixelsPerSecond.dx;
    final velocityCommits = _forward ? velocity < -600 : velocity > 600;
    final commit = _transitionController.value >= 0.22 || velocityCommits;
    unawaited(_settleHorizontalDrag(targetIndex, commit: commit));
  }

  void _handleHorizontalDragCancel() {
    if (!_interactiveTransition) return;
    _interactiveTransition = false;
    final targetIndex = _targetIndex;
    if (targetIndex == null) {
      _transitionController.reset();
      _play();
      return;
    }
    unawaited(_settleHorizontalDrag(targetIndex, commit: false));
  }

  Future<void> _settleHorizontalDrag(
    int targetIndex, {
    required bool commit,
  }) async {
    if (_reduceMotion) {
      if (!mounted) return;
      setState(() {
        if (commit) _index = targetIndex;
        _targetIndex = null;
      });
      _transitionController.reset();
      _play();
      if (commit) _precacheNeighbors();
      return;
    }

    final remaining = commit
        ? 1 - _transitionController.value
        : _transitionController.value;
    final milliseconds = (BulkaMotion.emphasized.inMilliseconds * remaining)
        .round()
        .clamp(90, BulkaMotion.emphasized.inMilliseconds)
        .toInt();
    if (commit) {
      await _transitionController.animateTo(
        1,
        duration: Duration(milliseconds: milliseconds),
        curve: BulkaMotion.enterCurve,
      );
    } else {
      await _transitionController.animateBack(
        0,
        duration: Duration(milliseconds: milliseconds),
        curve: BulkaMotion.exitCurve,
      );
    }
    if (!mounted) return;
    setState(() {
      if (commit) _index = targetIndex;
      _targetIndex = null;
    });
    _transitionController.reset();
    _play();
    if (commit) _precacheNeighbors();
  }

  void _handleVerticalDragStart(DragStartDetails details) {
    if (_transitionController.isAnimating || _interactiveTransition) return;
    _progressController.stop();
    setState(() {
      _verticalDragging = true;
      _verticalDragOffset = 0;
    });
  }

  void _handleVerticalDragUpdate(DragUpdateDetails details) {
    if (!_verticalDragging) return;
    setState(() {
      _verticalDragOffset = max(0.0, _verticalDragOffset + details.delta.dy);
    });
  }

  void _handleVerticalDragEnd(DragEndDetails details) {
    if (!_verticalDragging) return;
    final shouldDismiss =
        _verticalDragOffset >= 96 || details.velocity.pixelsPerSecond.dy > 700;
    if (shouldDismiss) {
      Navigator.of(context).maybePop();
      return;
    }
    setState(() {
      _verticalDragging = false;
      _verticalDragOffset = 0;
    });
    _play();
  }

  void _handleVerticalDragCancel() {
    if (!_verticalDragging) return;
    setState(() {
      _verticalDragging = false;
      _verticalDragOffset = 0;
    });
    _play();
  }

  @override
  Widget build(BuildContext context) {
    final story = widget.stories[_index];
    final targetStory = _targetIndex == null
        ? null
        : widget.stories[_targetIndex!];
    final viewportSize = MediaQuery.sizeOf(context);
    final desktopLayout = _usesDesktopStoryLayout(viewportSize);
    final viewer = CallbackShortcuts(
      bindings: <ShortcutActivator, VoidCallback>{
        const SingleActivator(LogicalKeyboardKey.arrowLeft): _previous,
        const SingleActivator(LogicalKeyboardKey.arrowRight): _next,
        const SingleActivator(LogicalKeyboardKey.escape): () =>
            Navigator.of(context).maybePop(),
      },
      child: Focus(
        autofocus: true,
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onHorizontalDragStart: _handleHorizontalDragStart,
          onHorizontalDragUpdate: _handleHorizontalDragUpdate,
          onHorizontalDragEnd: _handleHorizontalDragEnd,
          onHorizontalDragCancel: _handleHorizontalDragCancel,
          onVerticalDragStart: _handleVerticalDragStart,
          onVerticalDragUpdate: _handleVerticalDragUpdate,
          onVerticalDragEnd: _handleVerticalDragEnd,
          onVerticalDragCancel: _handleVerticalDragCancel,
          child: TweenAnimationBuilder<double>(
            tween: Tween<double>(end: _verticalDragOffset),
            duration: _verticalDragging
                ? Duration.zero
                : BulkaMotion.duration(context, BulkaMotion.fast),
            curve: _verticalDragging ? Curves.linear : BulkaMotion.enterCurve,
            builder: (context, offset, child) {
              final height = _storyRenderSize(
                MediaQuery.sizeOf(context),
              ).height.clamp(1.0, double.infinity);
              final dismissProgress = (offset / height).clamp(0.0, 1.0);
              return Transform.translate(
                offset: Offset(0, offset),
                transformHitTests: false,
                child: Opacity(
                  opacity: 1 - dismissProgress * 0.35,
                  child: child,
                ),
              );
            },
            child: Stack(
              fit: StackFit.expand,
              children: [
                _StoryLoadingSurface(story: story),
                BulkaHero(
                  tag: widget.heroTag,
                  child: AnimatedBuilder(
                    animation: _transitionController,
                    builder: (context, _) => _StoryCubeStage(
                      current: story,
                      target: targetStory,
                      progress: _transitionController.value,
                      forward: _forward,
                      interactive: _interactiveTransition,
                    ),
                  ),
                ),
                Row(
                  children: [
                    Expanded(
                      flex: 3,
                      child: Semantics(
                        button: true,
                        label: 'story_previous'.tr,
                        onTap: _previous,
                        excludeSemantics: true,
                        child: GestureDetector(
                          excludeFromSemantics: true,
                          behavior: HitTestBehavior.translucent,
                          onTap: _previous,
                        ),
                      ),
                    ),
                    Expanded(
                      flex: 7,
                      child: Semantics(
                        button: true,
                        label: 'story_next'.tr,
                        onTap: _next,
                        excludeSemantics: true,
                        child: GestureDetector(
                          excludeFromSemantics: true,
                          behavior: HitTestBehavior.translucent,
                          onTap: _next,
                        ),
                      ),
                    ),
                  ],
                ),
                SafeArea(
                  bottom: false,
                  child: Align(
                    alignment: Alignment.topCenter,
                    child: Container(
                      key: const ValueKey('story-controls'),
                      padding: const EdgeInsets.fromLTRB(14, 10, 10, 8),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          AnimatedBuilder(
                            animation: _progressController,
                            builder: (_, _) => Row(
                              children: [
                                for (var i = 0; i < widget.stories.length; i++)
                                  Expanded(
                                    child: Padding(
                                      padding: EdgeInsets.only(
                                        right: i == widget.stories.length - 1
                                            ? 0
                                            : 4,
                                      ),
                                      child: LinearProgressIndicator(
                                        value: _reduceMotion
                                            ? (i <= _index ? 1 : 0)
                                            : i < _index
                                            ? 1
                                            : i == _index
                                            ? _progressController.value
                                            : 0,
                                        minHeight: 3,
                                        color: _bulkaYellow,
                                        backgroundColor: Colors.white
                                            .withValues(alpha: 0.52),
                                        borderRadius: BorderRadius.circular(
                                          BulkaRadii.small,
                                        ),
                                      ),
                                    ),
                                  ),
                              ],
                            ),
                          ),
                          const SizedBox(height: 8),
                          Row(
                            children: [
                              Expanded(
                                child: Padding(
                                  padding: const EdgeInsets.only(left: 4),
                                  child: Text(
                                    story.localizedTitle,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                      fontFamily: _headingFont,
                                      color: Colors.white,
                                      fontSize: BulkaTypeScale.body,
                                      fontWeight: FontWeight.w700,
                                      shadows: [
                                        Shadow(
                                          color: Color(0x99000000),
                                          blurRadius: 8,
                                        ),
                                      ],
                                    ),
                                  ),
                                ),
                              ),
                              IconButton(
                                onPressed: () =>
                                    Navigator.of(context).maybePop(),
                                tooltip: 'close_tooltip'.tr,
                                style: IconButton.styleFrom(
                                  minimumSize: const Size(48, 48),
                                  backgroundColor: Colors.black.withValues(
                                    alpha: 0.18,
                                  ),
                                  foregroundColor: Colors.white,
                                ),
                                icon: const Icon(Icons.close_rounded, size: 29),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
    return Scaffold(
      backgroundColor: desktopLayout ? const Color(0xFF1B0D08) : Colors.white,
      body: desktopLayout
          ? _DesktopStoryViewport(
              story: story,
              onDismiss: () => Navigator.of(context).maybePop(),
              child: viewer,
            )
          : viewer,
    );
  }
}

class _StoryLoadingSurface extends StatelessWidget {
  const _StoryLoadingSurface({required this.story});

  final PromoStory story;

  @override
  Widget build(BuildContext context) {
    final reduceMotion = BulkaMotion.reduced(context);
    final previewUrl = story.localizedGroupCoverUrl.isNotEmpty
        ? story.localizedGroupCoverUrl
        : story.localizedImageUrl;
    return ExcludeSemantics(
      child: ColoredBox(
        color: Colors.white,
        child: Stack(
          key: const ValueKey('story-loading-effect'),
          fit: StackFit.expand,
          children: [
            if (previewUrl.startsWith('http'))
              ImageFiltered(
                imageFilter: ui.ImageFilter.blur(sigmaX: 18, sigmaY: 18),
                child: Transform.scale(
                  scale: 1.1,
                  child: _NetworkImage(
                    url: previewUrl,
                    fit: BoxFit.cover,
                    loadingPlaceholder: const SizedBox.expand(),
                    errorPlaceholder: const SizedBox.expand(),
                  ),
                ),
              ),
            ColoredBox(color: Colors.white.withValues(alpha: 0.52)),
            Center(
              child: Padding(
                key: const ValueKey('story-loading-content'),
                padding: const EdgeInsets.fromLTRB(24, 18, 24, 17),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Image.asset(
                      'assets/brand/bulka_logo.png',
                      key: const ValueKey('story-loading-logo'),
                      width: 160,
                      fit: BoxFit.contain,
                    ),
                    const SizedBox(height: 14),
                    Text(
                      'story_loading'.tr,
                      style: const TextStyle(
                        fontFamily: _headingFont,
                        color: _textDark,
                        fontSize: BulkaTypeScale.bodySmall,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 10),
                    SizedBox(
                      width: 138,
                      child: LinearProgressIndicator(
                        value: reduceMotion ? 0.68 : null,
                        minHeight: 4,
                        color: _bulkaYellow,
                        backgroundColor: const Color(0xFFEADBC4),
                        borderRadius: BorderRadius.circular(BulkaRadii.small),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

String _storyImageUrl(PromoStory story) {
  return story.localizedContentUrl.isNotEmpty
      ? story.localizedContentUrl
      : (story.localizedImageUrl.isNotEmpty
            ? story.localizedImageUrl
            : story.localizedGroupCoverUrl);
}

class _StoryFullImage extends StatelessWidget {
  const _StoryFullImage({required this.story});

  final PromoStory story;

  @override
  Widget build(BuildContext context) {
    final url = _storyImageUrl(story);
    if (url.startsWith('http')) {
      return SizedBox.expand(
        key: const ValueKey('story-media-frame'),
        child: _NetworkImage(
          url: url,
          fit: BoxFit.cover,
          semanticLabel: story.localizedTitle,
          loadingPlaceholder: const SizedBox.expand(),
          errorPlaceholder: const SizedBox.expand(),
        ),
      );
    }
    final isHappy =
        story.groupId == 'happy_hours' || story.localizedTitle.contains('2+1');
    return LayoutBuilder(
      builder: (context, constraints) {
        // During the Hero flight this widget briefly inherits the compact
        // banner size. Keep that intermediate frame responsive instead of
        // overflowing while it expands to full screen.
        final compact = constraints.maxHeight < 360;
        return Container(
          decoration: const BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [Color(0xFF381B10), Color(0xFF140804)],
            ),
          ),
          alignment: Alignment.center,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text(
                isHappy ? '2 + 1' : 'story_gift'.tr,
                style: TextStyle(
                  fontFamily: _headingFont,
                  fontSize: compact ? 42 : (isHappy ? 80 : 86),
                  fontWeight: FontWeight.w700,
                  color: const Color(0xFFDCAE68),
                ),
              ),
              SizedBox(height: compact ? 6 : 16),
              Padding(
                padding: EdgeInsets.symmetric(horizontal: compact ? 18 : 28),
                child: Text(
                  story.localizedTitle.toUpperCase(),
                  maxLines: compact ? 1 : 3,
                  overflow: TextOverflow.ellipsis,
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontFamily: _headingFont,
                    fontSize: compact ? 18 : 24,
                    fontWeight: FontWeight.w700,
                    color: Colors.white,
                  ),
                ),
              ),
              if (!compact &&
                  (story.localizedDescription ?? '').isNotEmpty) ...[
                const SizedBox(height: 14),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 36),
                  child: Text(
                    story.localizedDescription!,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontSize: BulkaTypeScale.body,
                      color: Color(0xFFEADBBE),
                      height: 1.4,
                    ),
                  ),
                ),
              ],
            ],
          ),
        );
      },
    );
  }
}

class _StoryCubeStage extends StatelessWidget {
  const _StoryCubeStage({
    required this.current,
    required this.target,
    required this.progress,
    required this.forward,
    required this.interactive,
  });

  final PromoStory current;
  final PromoStory? target;
  final double progress;
  final bool forward;
  final bool interactive;

  @override
  Widget build(BuildContext context) {
    final next = target;
    if (next == null) {
      return KeyedSubtree(
        key: const ValueKey('story-cube-stage'),
        child: RepaintBoundary(child: _StoryFullImage(story: current)),
      );
    }

    final normalized = progress.clamp(0.0, 1.0);
    final eased = interactive
        ? normalized
        : BulkaMotion.movementCurve.transform(normalized);
    return KeyedSubtree(
      key: const ValueKey('story-cube-stage'),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final width = constraints.maxWidth;
          final halfWidth = width / 2;
          final turn = forward ? -1.0 : 1.0;
          final angle = turn * eased * pi / 2;

          Matrix4 currentTransform() => Matrix4.identity()
            ..setEntry(3, 2, 0.00135)
            ..translateByDouble(0.0, 0.0, -halfWidth, 1.0)
            ..rotateY(angle)
            ..translateByDouble(0.0, 0.0, halfWidth, 1.0);

          Matrix4 targetTransform() => Matrix4.identity()
            ..setEntry(3, 2, 0.00135)
            ..translateByDouble(0.0, 0.0, -halfWidth, 1.0)
            ..rotateY(angle)
            ..translateByDouble(-turn * halfWidth, 0.0, 0.0, 1.0)
            ..rotateY(-turn * pi / 2);

          final currentFace = _StoryCubeFace(
            key: const ValueKey('story-current-face'),
            transform: currentTransform(),
            story: current,
            shade: 0.24 * eased,
            shadeFromLeft: forward,
          );
          final targetFace = _StoryCubeFace(
            key: const ValueKey('story-target-face'),
            transform: targetTransform(),
            story: next,
            shade: 0.22 * (1 - eased),
            shadeFromLeft: !forward,
          );

          // Flutter does not depth-sort separate widgets. Swap paint order at
          // the halfway point so the face closest to the viewer stays on top.
          final faces = eased < 0.5
              ? <Widget>[targetFace, currentFace]
              : <Widget>[currentFace, targetFace];
          return ClipRect(
            child: ColoredBox(
              color: Colors.black,
              child: Stack(fit: StackFit.expand, children: faces),
            ),
          );
        },
      ),
    );
  }
}

class _StoryCubeFace extends StatelessWidget {
  const _StoryCubeFace({
    required this.transform,
    required this.story,
    required this.shade,
    required this.shadeFromLeft,
    super.key,
  });

  final Matrix4 transform;
  final PromoStory story;
  final double shade;
  final bool shadeFromLeft;

  @override
  Widget build(BuildContext context) {
    final shadow = shade.clamp(0.0, 1.0);
    return Transform(
      transform: transform,
      alignment: Alignment.center,
      transformHitTests: false,
      child: RepaintBoundary(
        child: Stack(
          fit: StackFit.expand,
          children: [
            _StoryFullImage(story: story),
            if (shadow > 0)
              IgnorePointer(
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      begin: shadeFromLeft
                          ? Alignment.centerLeft
                          : Alignment.centerRight,
                      end: shadeFromLeft
                          ? Alignment.centerRight
                          : Alignment.centerLeft,
                      colors: [
                        Colors.transparent,
                        Colors.black.withValues(alpha: shadow),
                      ],
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
