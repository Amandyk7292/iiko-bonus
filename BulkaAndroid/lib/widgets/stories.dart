part of '../main.dart';

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
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        final v = _reduceMotion ? 0.5 : _controller.value;
        return LayoutBuilder(
          builder: (context, constraints) => Padding(
            padding: const EdgeInsets.symmetric(horizontal: 24),
            child: constraints.maxWidth >= 720
                ? Row(
                    children: [
                      Expanded(child: _buildCard(v)),
                      const SizedBox(width: 18),
                      Expanded(child: _buildCard(v)),
                    ],
                  )
                : _buildCard(v),
          ),
        );
      },
    );
  }

  Widget _buildCard(double value) {
    return Container(
      height: 146,
      clipBehavior: Clip.antiAlias,
      padding: const EdgeInsets.all(22),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(28),
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
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          _skeletonLine(180, 22, 8, const Color(0xFFE8E3DA)),
          const SizedBox(height: 12),
          _skeletonLine(240, 14, 6, const Color(0xFFF0EBE3)),
          const SizedBox(height: 8),
          _skeletonLine(140, 14, 6, const Color(0xFFF0EBE3)),
        ],
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
    if (!_dependenciesReady || reduceMotion != _reduceMotion) {
      _dependenciesReady = true;
      _reduceMotion = reduceMotion;
      _startTimer();
    }
  }

  void _startTimer() {
    _timer?.cancel();
    if (!_reduceMotion && widget.groups.length > 1) {
      _timer = Timer.periodic(const Duration(seconds: 5), (_) {
        if (!mounted || !_pageController.hasClients) return;
        final next = (_currentIndex + 1) % widget.groups.length;
        _pageController.animateToPage(
          next,
          duration: BulkaMotion.emphasized,
          curve: Curves.easeOutCubic,
        );
      });
    }
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
          return GridView.builder(
            padding: const EdgeInsets.symmetric(horizontal: 24),
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: 2,
              crossAxisSpacing: 18,
              mainAxisSpacing: 18,
              mainAxisExtent: 146,
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
            SizedBox(
              height: 136,
              child: PageView.builder(
                controller: _pageController,
                itemCount: widget.groups.length,
                onPageChanged: (idx) => setState(() => _currentIndex = idx),
                itemBuilder: (context, idx) => Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 24),
                  child: _PromoBannerCard(
                    group: widget.groups[idx],
                    viewed: widget.viewedGroups.contains(widget.groups[idx].id),
                    onTap: () => widget.onGroupTap(widget.groups[idx]),
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
                      borderRadius: BorderRadius.circular(3),
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
              borderRadius: BorderRadius.circular(22),
              child: AnimatedContainer(
                duration: BulkaMotion.duration(context, BulkaMotion.fast),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(22),
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
                  borderRadius: BorderRadius.circular(20.8),
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
      return _NetworkImage(url: group.coverUrl, fit: BoxFit.cover);
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
                    fontSize: 22,
                    fontWeight: FontWeight.w900,
                    color: Color(0xFFEADBBE),
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  group.subtitle ?? 'story_offer_fallback'.tr,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 13,
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
        story?.description ??
        story?.title ??
        'story_offer_fallback'.tr;
    final isHappy = group.id == 'happy_hours' || title.contains('2+1');

    return Scaffold(
      backgroundColor: const Color(0xFFFDF8F0),
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
                      borderRadius: BorderRadius.circular(20),
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
                        fontSize: 14,
                        fontWeight: FontWeight.w800,
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
                        fontSize: 25,
                        fontWeight: FontWeight.w900,
                        color: Color(0xFF4A2210),
                        height: 1.15,
                      ),
                    ),
                    const SizedBox(height: 12),
                    Text(
                      subtitle,
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        fontSize: 16,
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
                        borderRadius: BorderRadius.circular(24),
                        border: Border.all(
                          color: const Color(0xFFEADBBE),
                          width: 1.2,
                        ),
                      ),
                      child:
                          (story != null && story.contentUrl.startsWith('http'))
                          ? ClipRRect(
                              borderRadius: BorderRadius.circular(23),
                              child: _NetworkImage(
                                url: story.contentUrl,
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
                                    fontWeight: FontWeight.w900,
                                    color: const Color(0xFFD38B28),
                                  ),
                                ),
                                const SizedBox(height: 8),
                                Text(
                                  subtitle,
                                  style: const TextStyle(
                                    fontSize: 14,
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
                          borderRadius: BorderRadius.circular(24),
                        ),
                        elevation: 0,
                      ),
                      child: Text(
                        'catalog_action'.tr,
                        style: const TextStyle(
                          fontSize: 16,
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
  late AnimationController _controller;
  late AnimationController _cubeController;
  int? _targetIndex;
  bool _forward = true;

  @override
  void initState() {
    super.initState();
    _index = widget.initialIndex;
    _controller = AnimationController(vsync: this)
      ..addStatusListener((status) {
        if (status == AnimationStatus.completed) _next();
      });
    _cubeController = AnimationController(
      vsync: this,
      duration: BulkaMotion.emphasized,
    );
    _play();
  }

  @override
  void dispose() {
    _controller.dispose();
    _cubeController.dispose();
    super.dispose();
  }

  void _play() {
    final durationSec = widget.stories[_index].duration > 0
        ? widget.stories[_index].duration
        : 15;
    final duration = Duration(seconds: durationSec);
    _controller
      ..duration = duration
      ..reset()
      ..forward();
  }

  void _next() {
    if (_cubeController.isAnimating) return;
    if (_index < widget.stories.length - 1) {
      _goTo(_index + 1, forward: true);
    } else {
      Navigator.of(context).maybePop();
    }
  }

  void _previous() {
    if (_cubeController.isAnimating) return;
    if (_index > 0) {
      _goTo(_index - 1, forward: false);
    } else {
      Navigator.of(context).maybePop();
    }
  }

  Future<void> _goTo(int nextIndex, {required bool forward}) async {
    _controller.stop();
    BulkaMotion.selection();
    if (BulkaMotion.reduced(context)) {
      setState(() {
        _index = nextIndex;
        _targetIndex = null;
      });
      _play();
      return;
    }
    setState(() {
      _targetIndex = nextIndex;
      _forward = forward;
    });
    await _cubeController.forward(from: 0);
    if (!mounted) return;
    setState(() {
      _index = nextIndex;
      _targetIndex = null;
    });
    _cubeController.reset();
    _play();
  }

  @override
  Widget build(BuildContext context) {
    final story = widget.stories[_index];
    final targetStory = _targetIndex == null
        ? null
        : widget.stories[_targetIndex!];
    return Scaffold(
      backgroundColor: Colors.black,
      body: GestureDetector(
        onVerticalDragUpdate: (details) {
          if (details.delta.dy > 12) Navigator.of(context).maybePop();
        },
        child: Stack(
          fit: StackFit.expand,
          children: [
            BulkaHero(
              tag: widget.heroTag,
              child: AnimatedBuilder(
                animation: _cubeController,
                builder: (context, _) => _StoryCubeStage(
                  current: story,
                  target: targetStory,
                  progress: _cubeController.value,
                  forward: _forward,
                ),
              ),
            ),
            DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
                    Colors.black.withValues(alpha: 0.55),
                    Colors.transparent,
                    Colors.transparent,
                  ],
                ),
              ),
            ),
            Row(
              children: [
                Expanded(
                  flex: 3,
                  child: GestureDetector(
                    behavior: HitTestBehavior.translucent,
                    onTap: _previous,
                  ),
                ),
                Expanded(
                  flex: 7,
                  child: GestureDetector(
                    behavior: HitTestBehavior.translucent,
                    onTap: _next,
                  ),
                ),
              ],
            ),
            SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    AnimatedBuilder(
                      animation: _controller,
                      builder: (_, _) => Row(
                        children: [
                          for (var i = 0; i < widget.stories.length; i++)
                            Expanded(
                              child: Padding(
                                padding: EdgeInsets.only(
                                  right: i == widget.stories.length - 1 ? 0 : 4,
                                ),
                                child: LinearProgressIndicator(
                                  value: i < _index
                                      ? 1
                                      : i == _index
                                      ? _controller.value
                                      : 0,
                                  minHeight: 2.5,
                                  color: Colors.white,
                                  backgroundColor: Colors.white.withValues(
                                    alpha: 0.35,
                                  ),
                                  borderRadius: BorderRadius.circular(2),
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
                              story.title,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: Colors.white,
                                fontSize: 16.5,
                                fontWeight: FontWeight.w600,
                                shadows: [
                                  Shadow(blurRadius: 6, color: Colors.black54),
                                ],
                              ),
                            ),
                          ),
                        ),
                        IconButton(
                          onPressed: () => Navigator.of(context).maybePop(),
                          tooltip: 'close_tooltip'.tr,
                          icon: const Icon(
                            Icons.close,
                            color: Colors.white,
                            size: 28,
                          ),
                        ),
                      ],
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

class _StoryFullImage extends StatelessWidget {
  const _StoryFullImage({required this.story});

  final PromoStory story;

  @override
  Widget build(BuildContext context) {
    final url = story.contentUrl.isNotEmpty
        ? story.contentUrl
        : (story.imageUrl.isNotEmpty ? story.imageUrl : story.groupCoverUrl);
    if (url.startsWith('http')) {
      return _NetworkImage(url: url, fit: BoxFit.cover);
    }
    final isHappy =
        story.groupId == 'happy_hours' || story.title.contains('2+1');
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
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(
            isHappy ? '2 + 1' : 'story_gift'.tr,
            style: TextStyle(
              fontFamily: _headingFont,
              fontSize: isHappy ? 80 : 86,
              fontWeight: FontWeight.w900,
              color: const Color(0xFFDCAE68),
            ),
          ),
          const SizedBox(height: 16),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 28),
            child: Text(
              story.title.toUpperCase(),
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontFamily: _headingFont,
                fontSize: 24,
                fontWeight: FontWeight.w900,
                color: Colors.white,
              ),
            ),
          ),
          if ((story.description ?? '').isNotEmpty) ...[
            const SizedBox(height: 14),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 36),
              child: Text(
                story.description!,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 16,
                  color: Color(0xFFEADBBE),
                  height: 1.4,
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _StoryCubeStage extends StatelessWidget {
  const _StoryCubeStage({
    required this.current,
    required this.target,
    required this.progress,
    required this.forward,
  });

  final PromoStory current;
  final PromoStory? target;
  final double progress;
  final bool forward;

  @override
  Widget build(BuildContext context) {
    final next = target;
    if (next == null) {
      return _StoryFullImage(story: current);
    }

    final eased = Curves.easeInOutCubic.transform(progress.clamp(0, 1));
    return LayoutBuilder(
      builder: (context, constraints) {
        final width = constraints.maxWidth;
        final height = constraints.maxHeight;
        final half = width / 2;
        return Stack(
          fit: StackFit.expand,
          children: [
            _StoryFullImage(story: current),
            if (forward) ...[
              Positioned(
                right: 0,
                top: 0,
                bottom: 0,
                width: half,
                child: ColoredBox(
                  color: Colors.black.withValues(alpha: 0.42 * eased),
                ),
              ),
              _CubeHalfFace(
                story: current,
                side: _StoryHalf.left,
                width: width,
                height: height,
                angle: -eased * pi / 2,
                transformAlignment: Alignment.centerRight,
              ),
              _CubeHalfFace(
                story: next,
                side: _StoryHalf.right,
                width: width,
                height: height,
                angle: (1 - eased) * pi / 2,
                transformAlignment: Alignment.centerLeft,
              ),
            ] else ...[
              Positioned(
                left: 0,
                top: 0,
                bottom: 0,
                width: half,
                child: ColoredBox(
                  color: Colors.black.withValues(alpha: 0.42 * eased),
                ),
              ),
              _CubeHalfFace(
                story: current,
                side: _StoryHalf.right,
                width: width,
                height: height,
                angle: eased * pi / 2,
                transformAlignment: Alignment.centerLeft,
              ),
              _CubeHalfFace(
                story: next,
                side: _StoryHalf.left,
                width: width,
                height: height,
                angle: -(1 - eased) * pi / 2,
                transformAlignment: Alignment.centerRight,
              ),
            ],
            Center(
              child: Container(
                width: 1.5,
                height: height,
                color: Colors.black.withValues(
                  alpha: 0.35 * sin(progress * pi),
                ),
              ),
            ),
          ],
        );
      },
    );
  }
}

enum _StoryHalf { left, right }

class _CubeHalfFace extends StatelessWidget {
  const _CubeHalfFace({
    required this.story,
    required this.side,
    required this.width,
    required this.height,
    required this.angle,
    required this.transformAlignment,
  });

  final PromoStory story;
  final _StoryHalf side;
  final double width;
  final double height;
  final double angle;
  final Alignment transformAlignment;

  @override
  Widget build(BuildContext context) {
    final isLeft = side == _StoryHalf.left;
    final matrix = Matrix4.identity()
      ..setEntry(3, 2, 0.0012)
      ..rotateY(angle);

    return Positioned(
      left: isLeft ? 0 : width / 2,
      top: 0,
      width: width / 2,
      height: height,
      child: ClipRect(
        child: Transform(
          alignment: transformAlignment,
          transform: matrix,
          child: Align(
            alignment: isLeft ? Alignment.centerLeft : Alignment.centerRight,
            child: SizedBox(
              width: width,
              height: height,
              child: Stack(
                fit: StackFit.expand,
                children: [
                  _StoryFullImage(story: story),
                  DecoratedBox(
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        begin: isLeft
                            ? Alignment.centerRight
                            : Alignment.centerLeft,
                        end: isLeft
                            ? Alignment.centerLeft
                            : Alignment.centerRight,
                        colors: [
                          Colors.black.withValues(alpha: 0.16),
                          Colors.transparent,
                        ],
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
