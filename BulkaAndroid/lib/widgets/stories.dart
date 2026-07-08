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

  @override
  void initState() {
    super.initState();
    _pageController = PageController();
    _startTimer();
  }

  void _startTimer() {
    _timer?.cancel();
    if (widget.groups.length > 1) {
      _timer = Timer.periodic(const Duration(seconds: 5), (_) {
        if (!mounted || !_pageController.hasClients) return;
        final next = (_currentIndex + 1) % widget.groups.length;
        _pageController.animateToPage(
          next,
          duration: const Duration(milliseconds: 500),
          curve: Curves.easeInOutCubic,
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

    return Column(
      children: [
        SizedBox(
          height: 136,
          child: PageView.builder(
            controller: _pageController,
            itemCount: widget.groups.length,
            onPageChanged: (idx) => setState(() => _currentIndex = idx),
            itemBuilder: (context, idx) {
              final group = widget.groups[idx];
              final firstStory = group.stories.isNotEmpty ? group.stories.first : null;
              final subText = group.subtitle ?? firstStory?.description ?? firstStory?.title ?? 'Специальное предложение для гостей Bulka!';

              return Padding(
                padding: const EdgeInsets.symmetric(horizontal: 24),
                child: InkWell(
                  onTap: () => widget.onGroupTap(group),
                  borderRadius: BorderRadius.circular(22),
                  child: Container(
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                        colors: [Color(0xFFFFFBF3), Color(0xFFFAF0DD)],
                      ),
                      borderRadius: BorderRadius.circular(22),
                      border: Border.all(color: const Color(0xFFEADBBE), width: 1.2),
                      boxShadow: [
                        BoxShadow(
                          color: const Color(0xFF6D3317).withValues(alpha: 0.10),
                          blurRadius: 16,
                          offset: const Offset(0, 6),
                        ),
                      ],
                    ),
                    child: Row(
                      children: [
                        Expanded(
                          child: Padding(
                            padding: const EdgeInsets.fromLTRB(20, 16, 12, 16),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3.5),
                                  decoration: BoxDecoration(
                                    color: const Color(0xFFFFE8C2),
                                    borderRadius: BorderRadius.circular(12),
                                  ),
                                  child: const Text(
                                    '✨ АКЦИЯ',
                                    style: TextStyle(
                                      color: Color(0xFF7E4A1D),
                                      fontSize: 9.5,
                                      fontWeight: FontWeight.w800,
                                    ),
                                  ),
                                ),
                                const SizedBox(height: 7),
                                Text(
                                  group.title.toUpperCase(),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    fontFamily: _headingFont,
                                    fontSize: 16.5,
                                    fontWeight: FontWeight.w900,
                                    color: Color(0xFF4A2210),
                                    height: 1.15,
                                  ),
                                ),
                                const SizedBox(height: 4),
                                Text(
                                  subText,
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    fontSize: 12.0,
                                    color: Color(0xFF8B5E3C),
                                    height: 1.25,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                        SizedBox(
                          width: 130,
                          height: double.infinity,
                          child: _PromoBannerIllustration(group: group),
                        ),
                      ],
                    ),
                  ),
                ),
              );
            },
          ),
        ),
        if (widget.groups.length > 1) ...[
          const SizedBox(height: 10),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: List.generate(widget.groups.length, (idx) {
              final active = idx == _currentIndex;
              return AnimatedContainer(
                duration: const Duration(milliseconds: 280),
                margin: const EdgeInsets.symmetric(horizontal: 3),
                width: active ? 20 : 6,
                height: 5,
                decoration: BoxDecoration(
                  color: active ? const Color(0xFFFFB300) : const Color(0xFFE4D3BA),
                  borderRadius: BorderRadius.circular(3),
                ),
              );
            }),
          ),
        ],
      ],
    );
  }
}

class _PromoBannerIllustration extends StatelessWidget {
  const _PromoBannerIllustration({required this.group});

  final StoryGroup group;

  @override
  Widget build(BuildContext context) {
    if (group.coverUrl.startsWith('http')) {
      return ClipRRect(
        borderRadius: const BorderRadius.horizontal(right: Radius.circular(20)),
        child: _NetworkImage(url: group.coverUrl, fit: BoxFit.cover),
      );
    }

    final isHappy = group.id == 'happy_hours' || group.title.contains('ЧАСЫ') || group.title.contains('2+1');
    return Container(
      alignment: Alignment.center,
      decoration: const BoxDecoration(
        borderRadius: BorderRadius.horizontal(right: Radius.circular(20)),
      ),
      child: Stack(
        alignment: Alignment.center,
        children: [
          Positioned(
            right: -10,
            bottom: -10,
            child: Container(
              width: 90,
              height: 90,
              decoration: BoxDecoration(
                color: const Color(0xFFFFE3B0).withValues(alpha: 0.45),
                shape: BoxShape.circle,
              ),
            ),
          ),
          Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text(
                isHappy ? '2+1' : '🎁',
                style: TextStyle(
                  fontFamily: _headingFont,
                  fontSize: isHappy ? 34 : 36,
                  fontWeight: FontWeight.w900,
                  color: const Color(0xFFD38B28),
                  shadows: [
                    Shadow(
                      color: const Color(0xFF6D3317).withValues(alpha: 0.20),
                      blurRadius: 8,
                      offset: const Offset(0, 3),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 2),
              Text(
                isHappy ? 'БОНУС ВЕЧЕРОМ' : '+500 БАЛЛОВ',
                style: const TextStyle(
                  fontSize: 9.5,
                  fontWeight: FontWeight.w800,
                  color: Color(0xFF8B5E3C),
                ),
              ),
            ],
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
    final subtitle = group.subtitle ?? story?.description ?? story?.title ?? 'Специальное предложение для гостей Bulka Cafe!';
    final isHappy = group.id == 'happy_hours' || title.contains('ЧАСЫ') || title.contains('2+1');

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
                    padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 7),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(color: const Color(0xFFEADBBE)),
                      boxShadow: [
                        BoxShadow(
                          color: const Color(0xFF6D3317).withValues(alpha: 0.05),
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
                      icon: const Icon(Icons.close, color: Color(0xFF5A2A18), size: 26),
                    ),
                  ),
                ],
              ),
            ),
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 16),
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
                        border: Border.all(color: const Color(0xFFEADBBE), width: 1.2),
                      ),
                      child: (story != null && story.contentUrl.startsWith('http'))
                          ? ClipRRect(
                              borderRadius: BorderRadius.circular(23),
                              child: _NetworkImage(url: story.contentUrl, fit: BoxFit.cover),
                            )
                          : Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Text(
                                  isHappy ? '2 + 1' : '🎁',
                                  style: TextStyle(
                                    fontFamily: _headingFont,
                                    fontSize: isHappy ? 64 : 68,
                                    fontWeight: FontWeight.w900,
                                    color: const Color(0xFFD38B28),
                                  ),
                                ),
                                const SizedBox(height: 8),
                                Text(
                                  isHappy ? '3 булочки по цене 2-х после 21:00' : 'Бонус за каждого друга',
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
                  const Text(
                    'Только для участников программы лояльности!',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 12.5, color: Color(0xFF9A714A)),
                  ),
                  const SizedBox(height: 14),
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton(
                      onPressed: () => Navigator.of(context).maybePop(),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFFDCAE68),
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.symmetric(vertical: 16),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(24),
                        ),
                        elevation: 0,
                      ),
                      child: const Text(
                        'Заказать',
                        style: TextStyle(
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
    super.key,
  });

  final List<PromoStory> stories;
  final int initialIndex;

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
      duration: const Duration(milliseconds: 460),
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
    final duration = Duration(seconds: max(widget.stories[_index].duration, 3));
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
            AnimatedBuilder(
              animation: _cubeController,
              builder: (context, _) => _StoryCubeStage(
                current: story,
                target: targetStory,
                progress: _cubeController.value,
                forward: _forward,
              ),
            ),
            DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
                    Colors.black.withValues(alpha: 0.7),
                    Colors.transparent,
                    Colors.transparent,
                    Colors.black.withValues(alpha: 0.8),
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
                padding: const EdgeInsets.fromLTRB(16, 14, 16, 0),
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
                                  minHeight: 3,
                                  color: Colors.white,
                                  backgroundColor: Colors.white.withValues(
                                    alpha: 0.3,
                                  ),
                                  borderRadius: BorderRadius.circular(2),
                                ),
                              ),
                            ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        Container(
                          width: 32,
                          height: 32,
                          decoration: const BoxDecoration(
                            color: _bulkaBrown,
                            shape: BoxShape.circle,
                          ),
                          alignment: Alignment.center,
                          child: const Text(
                            'B',
                            style: TextStyle(
                              color: Colors.white,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            story.title,
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 15,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                        IconButton(
                          onPressed: () => Navigator.of(context).maybePop(),
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
            if ((story.description ?? '').isNotEmpty)
              Positioned(
                left: 20,
                right: 20,
                bottom: 40,
                child: SafeArea(
                  top: false,
                  child: Text(
                    story.description!,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 15,
                      height: 1.45,
                      fontWeight: FontWeight.w500,
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
      return _NetworkImage(url: current.contentUrl, fit: BoxFit.cover);
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
            _NetworkImage(url: current.contentUrl, fit: BoxFit.cover),
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
                width: 2,
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.12),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withValues(alpha: 0.28),
                      blurRadius: 18,
                    ),
                  ],
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
                  _NetworkImage(url: story.contentUrl, fit: BoxFit.cover),
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
