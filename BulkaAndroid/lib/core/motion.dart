part of '../main.dart';

abstract final class BulkaMotion {
  // Material 3 motion tokens keep every interaction on the same rhythm.
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

  static Future<void> confirm() => HapticFeedback.mediumImpact();
}

class BulkaHero extends StatelessWidget {
  const BulkaHero({required this.tag, required this.child, super.key});

  final Object tag;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    if (BulkaMotion.reduced(context)) return child;
    return Hero(tag: tag, transitionOnUserGestures: true, child: child);
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
      layoutBuilder: layoutBuilder,
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
    this.pressedOpacity = 0.96,
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
    final renderObject = context.findRenderObject();
    if (renderObject is! RenderBox) return;
    _setPressed(
      (Offset.zero & renderObject.size).contains(event.localPosition),
    );
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
      onPointerDown: (_) => _setPressed(true),
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
            child: Opacity(opacity: opacity, child: child),
          );
        },
      ),
    );
  }
}
