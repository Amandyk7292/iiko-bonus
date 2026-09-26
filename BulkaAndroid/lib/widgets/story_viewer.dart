part of '../main.dart';

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
    final ratio = networkImageDevicePixelRatio(
      media.devicePixelRatio,
      isWeb: kIsWeb,
    );
    final pixelWidth = _imagePixelBucket(renderSize.width * ratio);
    final pixelHeight = _imagePixelBucket(renderSize.height * ratio);
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
        precacheImage(
          networkImageCacheProvider(
            effectiveUrl,
            pixelWidth: pixelWidth,
            pixelHeight: pixelHeight,
          ),
          context,
          onError: (_, _) {},
        ),
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

  Widget _storyControls(
    PromoStory story,
    int index, {
    Key? controlsKey,
  }) => SafeArea(
    bottom: false,
    child: Align(
      alignment: Alignment.topCenter,
      child: Container(
        key: controlsKey,
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
                          right: i == widget.stories.length - 1 ? 0 : 4,
                        ),
                        child: LinearProgressIndicator(
                          value: _reduceMotion
                              ? (i <= index ? 1 : 0)
                              : i < index
                              ? 1
                              : i == index
                              ? _progressController.value
                              : 0,
                          minHeight: 3,
                          color: _bulkaYellow,
                          backgroundColor: Colors.white.withValues(alpha: 0.52),
                          borderRadius: BorderRadius.circular(BulkaRadii.small),
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
                          Shadow(color: Color(0x99000000), blurRadius: 8),
                        ],
                      ),
                    ),
                  ),
                ),
                IconButton(
                  onPressed: () => Navigator.of(context).maybePop(),
                  tooltip: 'close_tooltip'.tr,
                  style: IconButton.styleFrom(
                    minimumSize: const Size(48, 48),
                    backgroundColor: Colors.black.withValues(alpha: 0.18),
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
  );

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
                      currentOverlay: _storyControls(story, _index),
                      targetOverlay: targetStory == null
                          ? null
                          : _storyControls(targetStory, _targetIndex!),
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
                if (targetStory == null)
                  _storyControls(
                    story,
                    _index,
                    controlsKey: const ValueKey('story-controls'),
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
                  children: const [
                    SizedBox.square(
                      key: ValueKey('story-loading-spinner'),
                      dimension: 48,
                      child: CircularProgressIndicator(
                        color: Color(0xFFFFB814),
                        strokeWidth: 3.5,
                        strokeCap: StrokeCap.round,
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
    this.currentOverlay,
    this.targetOverlay,
  });

  final PromoStory current;
  final PromoStory? target;
  final double progress;
  final bool forward;
  final bool interactive;
  final Widget? currentOverlay, targetOverlay;

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
          // Positive z faces the viewer. Keep the leading cube edge in the
          // screen plane; the outer edges recede instead of folding inward.
          final depth = halfWidth * (cos(angle) + sin(angle).abs());
          final perspective = -1 / (width * 2.2);

          Matrix4 currentTransform() => Matrix4.identity()
            ..setEntry(3, 2, perspective)
            ..translateByDouble(0.0, 0.0, -depth, 1.0)
            ..rotateY(angle)
            ..translateByDouble(0.0, 0.0, halfWidth, 1.0);

          Matrix4 targetTransform() => Matrix4.identity()
            ..setEntry(3, 2, perspective)
            ..translateByDouble(0.0, 0.0, -depth, 1.0)
            ..rotateY(angle)
            ..translateByDouble(-turn * halfWidth, 0.0, 0.0, 1.0)
            ..rotateY(-turn * pi / 2);

          final currentFace = _StoryCubeFace(
            key: const ValueKey('story-current-face'),
            transform: currentTransform(),
            story: current,
            overlay: currentOverlay,
            shade: 0.24 * eased,
            shadeFromLeft: forward,
          );
          final targetFace = _StoryCubeFace(
            key: const ValueKey('story-target-face'),
            transform: targetTransform(),
            story: next,
            overlay: targetOverlay,
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
    this.overlay,
    super.key,
  });

  final Matrix4 transform;
  final PromoStory story;
  final double shade;
  final bool shadeFromLeft;
  final Widget? overlay;

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
            if (overlay != null)
              IgnorePointer(child: ExcludeSemantics(child: overlay!)),
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
