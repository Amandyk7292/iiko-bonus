part of '../main.dart';

abstract final class BulkaMotion {
  // Material 3 motion tokens keep every interaction on the same rhythm.
  static const navigation = Duration(milliseconds: 420);
  static AnimationStyle sheetStyle(BuildContext context) => reduced(context)
      ? AnimationStyle.noAnimation
      : const AnimationStyle(duration: navigation, reverseDuration: navigation);

  static const press = Durations.short2;
  static const fast = Durations.short3;
  static const standard = Durations.medium1;
  static const emphasized = Durations.medium3;

  static const Curve enterCurve = Easing.emphasizedDecelerate;
  static const Curve exitCurve = Easing.standardAccelerate;
  static const Curve standardCurve = Easing.standard;
  static const Curve movementCurve = Cubic(0.77, 0, 0.175, 1);

  static bool reduced(BuildContext context) {
    return MediaQuery.maybeDisableAnimationsOf(context) ?? false;
  }

  static Duration duration(BuildContext context, Duration normal) {
    return reduced(context) ? Duration.zero : normal;
  }

  static Future<void> selection() => HapticFeedback.selectionClick();

  static Future<void> lightImpact() => HapticFeedback.lightImpact();

  static DateTime? _lastErrorFeedback;
  static Future<void> error() async {
    final now = DateTime.now();
    if (_lastErrorFeedback != null &&
        now.difference(_lastErrorFeedback!) <
            const Duration(milliseconds: 400)) {
      return;
    }
    _lastErrorFeedback = now;
    await HapticFeedback.lightImpact();
  }

  static Future<void> confirm() => HapticFeedback.mediumImpact();
}

class BulkaHero extends StatelessWidget {
  const BulkaHero({
    required this.tag,
    required this.child,
    this.freezeImageDuringFlight = false,
    super.key,
  });

  final Object tag;
  final bool freezeImageDuringFlight;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    if (BulkaMotion.reduced(context)) return child;
    return Hero(
      tag: tag,
      transitionOnUserGestures: true,
      createRectTween: freezeImageDuringFlight
          ? (begin, end) => RectTween(begin: begin, end: end)
          : null,
      flightShuttleBuilder: freezeImageDuringFlight
          ? (flightContext, animation, direction, fromContext, toContext) {
              final source = fromContext.widget as Hero;
              final render = fromContext.findRenderObject();
              final size = render is RenderBox && render.hasSize
                  ? render.size
                  : const Size(200, 200);
              return ClipRRect(
                borderRadius: BorderRadius.circular(BulkaRadii.card),
                child: FittedBox(
                  fit: BoxFit.cover,
                  child: SizedBox.fromSize(size: size, child: source.child),
                ),
              );
            }
          : null,
      child: child,
    );
  }
}

class BulkaMotionSwitcher extends StatelessWidget {
  const BulkaMotionSwitcher({
    required this.child,
    this.duration = BulkaMotion.standard,
    this.offset = const Offset(0, 0.025),
    this.scale = 0.99,
    this.layoutBuilder = AnimatedSwitcher.defaultLayoutBuilder,
    super.key,
  });

  final Widget child;
  final Duration duration;
  final Offset offset;
  final double scale;
  final AnimatedSwitcherLayoutBuilder layoutBuilder;

  @override
  Widget build(BuildContext context) {
    final effectiveDuration = BulkaMotion.duration(context, duration);
    return AnimatedSwitcher(
      duration: effectiveDuration,
      reverseDuration: effectiveDuration,
      switchInCurve: BulkaMotion.enterCurve,
      switchOutCurve: BulkaMotion.exitCurve,
      layoutBuilder: (currentChild, previousChildren) => layoutBuilder(
        currentChild,
        previousChildren
            .map(
              (child) => HeroMode(
                enabled: false,
                child: ExcludeFocus(
                  child: ExcludeSemantics(child: IgnorePointer(child: child)),
                ),
              ),
            )
            .toList(),
      ),
      transitionBuilder: (child, animation) {
        if (effectiveDuration == Duration.zero) return child;
        return FadeTransition(
          opacity: animation,
          child: SlideTransition(
            position: Tween<Offset>(
              begin: offset,
              end: Offset.zero,
            ).animate(animation),
            child: ScaleTransition(
              scale: Tween<double>(begin: scale, end: 1).animate(animation),
              child: child,
            ),
          ),
        );
      },
      child: child,
    );
  }
}

class BulkaExpandable extends StatelessWidget {
  const BulkaExpandable({
    required this.expanded,
    required this.child,
    this.duration = BulkaMotion.standard,
    super.key,
  });

  final bool expanded;
  final Widget child;
  final Duration duration;

  @override
  Widget build(BuildContext context) {
    return TweenAnimationBuilder<double>(
      tween: Tween<double>(end: expanded ? 1 : 0),
      duration: BulkaMotion.duration(context, duration),
      curve: expanded ? BulkaMotion.enterCurve : BulkaMotion.exitCurve,
      child: RepaintBoundary(child: child),
      builder: (context, value, child) => ClipRect(
        // Keep overflow clipped only while the section is moving. Once fully
        // expanded, rounded card/button shadows may render naturally instead
        // of being cut into a sharp rectangle by the animation boundary.
        clipBehavior: value >= 0.999 ? Clip.none : Clip.hardEdge,
        child: Align(
          alignment: Alignment.topCenter,
          heightFactor: value,
          child: ExcludeSemantics(
            excluding: !expanded,
            child: ExcludeFocus(
              excluding: !expanded,
              child: IgnorePointer(
                ignoring: !expanded,
                child: Opacity(opacity: value, child: child),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class BulkaAdaptiveFrame extends StatelessWidget {
  const BulkaAdaptiveFrame({
    required this.child,
    this.maxWidth = 1180,
    super.key,
  });

  final Widget child;
  final double maxWidth;

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.topCenter,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: maxWidth),
        child: child,
      ),
    );
  }
}

class BulkaPressScale extends StatefulWidget {
  const BulkaPressScale({
    required this.child,
    this.enabled = true,
    this.pressedScale = 0.985,
    this.pressedOpacity = 1,
    super.key,
  });

  final Widget child;
  final bool enabled;
  final double pressedScale;
  final double pressedOpacity;

  @override
  State<BulkaPressScale> createState() => _BulkaPressScaleState();
}

class _BulkaPressScaleState extends State<BulkaPressScale>
    with SingleTickerProviderStateMixin {
  // Critically damped springs keep the press instant and the release smooth
  // without decorative bounce. Retargeting the live controller preserves
  // velocity when a finger changes direction mid-gesture.
  static const _pressSpring = SpringDescription(
    mass: 1,
    stiffness: 950,
    damping: 62,
  );
  static const _releaseSpring = SpringDescription(
    mass: 1,
    stiffness: 520,
    damping: 46,
  );

  late final AnimationController _scaleController =
      AnimationController.unbounded(vsync: this, value: 1);
  bool _pressed = false;
  Offset? _pointerOrigin;

  void _setPressed(bool value) {
    if (!widget.enabled || _pressed == value) return;
    _pressed = value;
    _animateTo(value ? widget.pressedScale : 1);
  }

  void _animateTo(double target) {
    if (BulkaMotion.reduced(context)) {
      _scaleController.value = 1;
      return;
    }
    _scaleController.animateWith(
      SpringSimulation(
        target < _scaleController.value ? _pressSpring : _releaseSpring,
        _scaleController.value,
        target,
        _scaleController.velocity,
      ),
    );
  }

  void _handlePointerMove(PointerMoveEvent event) {
    if (!_pressed) return;
    final origin = _pointerOrigin;
    if (origin != null && (event.position - origin).distance > 18) {
      _setPressed(false);
      return;
    }
    final renderObject = context.findRenderObject();
    if (renderObject is RenderBox &&
        !(Offset.zero & renderObject.size).contains(event.localPosition)) {
      _setPressed(false);
    }
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (BulkaMotion.reduced(context)) {
      _pressed = false;
      _scaleController.value = 1;
    }
  }

  @override
  void didUpdateWidget(covariant BulkaPressScale oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!widget.enabled && oldWidget.enabled) {
      _pressed = false;
      _animateTo(1);
    }
  }

  @override
  void dispose() {
    _scaleController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Listener(
      behavior: HitTestBehavior.translucent,
      onPointerDown: (event) {
        _pointerOrigin = event.position;
        _setPressed(true);
      },
      onPointerMove: _handlePointerMove,
      onPointerUp: (_) => _setPressed(false),
      onPointerCancel: (_) => _setPressed(false),
      child: AnimatedBuilder(
        animation: _scaleController,
        child: widget.child,
        builder: (context, child) {
          final scale = _scaleController.value;
          final range = 1 - widget.pressedScale;
          final pressProgress = range <= 0
              ? 0.0
              : ((1 - scale) / range).clamp(0.0, 1.0);
          final opacity = 1 - pressProgress * (1 - widget.pressedOpacity);
          return Transform.scale(
            scale: scale,
            transformHitTests: false,
            child: widget.pressedOpacity == 1
                ? child
                : Opacity(opacity: opacity, child: child),
          );
        },
      ),
    );
  }
}

/// Uses the platform's reversible page transition and native back gesture.
class BulkaPageRoute<T> extends MaterialPageRoute<T> {
  BulkaPageRoute({required super.builder, required this.reduceMotion});

  final bool reduceMotion;

  @override
  Duration get transitionDuration =>
      reduceMotion ? Duration.zero : super.transitionDuration;

  @override
  Duration get reverseTransitionDuration =>
      reduceMotion ? Duration.zero : super.reverseTransitionDuration;

  @override
  Widget buildTransitions(
    BuildContext context,
    Animation<double> animation,
    Animation<double> secondaryAnimation,
    Widget child,
  ) {
    if (reduceMotion || BulkaMotion.reduced(context)) return child;
    return super.buildTransitions(
      context,
      animation,
      secondaryAnimation,
      child,
    );
  }
}

/// Keep the native interactive iOS back gesture, with equal open/close timing.
class BulkaCupertinoPageTransitionsBuilder
    extends CupertinoPageTransitionsBuilder {
  const BulkaCupertinoPageTransitionsBuilder();
  @override
  Duration get transitionDuration => BulkaMotion.navigation;
  @override
  Duration get reverseTransitionDuration => BulkaMotion.navigation;
}

/// A directional transition for in-place pages such as catalog categories.
class BulkaPageSwitcher extends StatefulWidget {
  const BulkaPageSwitcher({
    required this.child,
    required this.reverse,
    super.key,
  });
  final Widget child;
  final bool reverse;
  @override
  State<BulkaPageSwitcher> createState() => _BulkaPageSwitcherState();
}

class _BulkaPageSwitcherState extends State<BulkaPageSwitcher>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  Widget? _previous;
  Animation<Offset> _incoming = const AlwaysStoppedAnimation(Offset.zero);
  Animation<Offset> _outgoing = const AlwaysStoppedAnimation(Offset.zero);

  @override
  void initState() {
    super.initState();
    _controller =
        AnimationController(
          vsync: this,
          duration: BulkaMotion.navigation,
          value: 1,
        )..addStatusListener((status) {
          if (status == AnimationStatus.completed &&
              mounted &&
              _previous != null) {
            setState(() => _previous = null);
          }
        });
  }

  @override
  void didUpdateWidget(covariant BulkaPageSwitcher oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.child.key == widget.child.key) return;
    if (BulkaMotion.reduced(context)) {
      _previous = null;
      _controller.value = 1;
      _incoming = const AlwaysStoppedAnimation(Offset.zero);
      return;
    }
    final incomingStart = _previous?.key == widget.child.key
        ? _outgoing.value
        : Offset(widget.reverse ? -0.25 : 1, 0);
    final outgoingStart = _incoming.value;
    _previous = oldWidget.child;
    final curve = _controller.drive(CurveTween(curve: Curves.easeInOutCubic));
    _incoming = Tween<Offset>(
      begin: incomingStart,
      end: Offset.zero,
    ).animate(curve);
    _outgoing = Tween<Offset>(
      begin: outgoingStart,
      end: Offset(widget.reverse ? 1 : -0.25, 0),
    ).animate(curve);
    _controller.forward(from: 0);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (BulkaMotion.reduced(context)) {
      _previous = null;
      _controller.value = 1;
      _incoming = const AlwaysStoppedAnimation(Offset.zero);
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Widget _page(Widget page, Animation<Offset> position, bool active) =>
      KeyedSubtree(
        key: ValueKey(page.key),
        child: SlideTransition(
          position: position,
          child: HeroMode(
            enabled: active,
            child: TickerMode(
              enabled: active,
              child: ExcludeSemantics(
                excluding: !active,
                child: ExcludeFocus(
                  excluding: !active,
                  child: IgnorePointer(
                    ignoring: !active,
                    child: RepaintBoundary(child: page),
                  ),
                ),
              ),
            ),
          ),
        ),
      );

  @override
  Widget build(BuildContext context) => ClipRect(
    child: Stack(
      fit: StackFit.expand,
      children: [
        if (_previous != null) _page(_previous!, _outgoing, false),
        _page(widget.child, _incoming, true),
      ],
    ),
  );
}
