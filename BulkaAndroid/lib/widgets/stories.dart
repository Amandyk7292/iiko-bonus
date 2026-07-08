part of '../main.dart';

class StoryGroup {
  const StoryGroup({
    required this.id,
    required this.title,
    required this.coverUrl,
    required this.stories,
  });

  final String id;
  final String title;
  final String coverUrl;
  final List<PromoStory> stories;
}

class StoryTile extends StatelessWidget {
  const StoryTile({
    required this.group,
    required this.viewed,
    required this.onTap,
    super.key,
  });

  final StoryGroup group;
  final bool viewed;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Container(
        width: 76,
        height: 98,
        clipBehavior: Clip.antiAlias,
        decoration: BoxDecoration(
          color: const Color(0xFF1B1B1B),
          borderRadius: BorderRadius.circular(8),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.12),
              blurRadius: 10,
              offset: const Offset(0, 5),
            ),
          ],
        ),
        child: Stack(
          fit: StackFit.expand,
          children: [
            ColorFiltered(
              colorFilter: viewed
                  ? const ColorFilter.matrix([
                      0.2126,
                      0.7152,
                      0.0722,
                      0,
                      0,
                      0.2126,
                      0.7152,
                      0.0722,
                      0,
                      0,
                      0.2126,
                      0.7152,
                      0.0722,
                      0,
                      0,
                      0,
                      0,
                      0,
                      1,
                      0,
                    ])
                  : const ColorFilter.mode(Colors.transparent, BlendMode.dst),
              child: _NetworkImage(url: group.coverUrl, fit: BoxFit.cover),
            ),
            if (viewed) ColoredBox(color: Colors.black.withValues(alpha: 0.34)),
            DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
                    Colors.black.withValues(alpha: 0.76),
                    Colors.black.withValues(alpha: 0.22),
                    Colors.black.withValues(alpha: 0.34),
                  ],
                ),
              ),
            ),
            Positioned(
              left: 7,
              right: 7,
              top: 7,
              child: Text(
                group.title.toUpperCase(),
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: Colors.white,
                  fontFamily: _headingFont,
                  fontSize: 8.5,
                  height: 1.08,
                  fontWeight: FontWeight.w400,
                ),
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
