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
    super.key,
  });

  final Widget child;
  final bool enabled;
  final double pressedScale;

  @override
  State<BulkaPressScale> createState() => _BulkaPressScaleState();
}

class _BulkaPressScaleState extends State<BulkaPressScale> {
  bool _pressed = false;

  void _setPressed(bool value) {
    if (!widget.enabled || _pressed == value) return;
    setState(() => _pressed = value);
  }

  @override
  Widget build(BuildContext context) {
    final reduced = BulkaMotion.reduced(context);
    final pressed = !reduced && _pressed;
    return Listener(
      onPointerDown: (_) => _setPressed(true),
      onPointerUp: (_) => _setPressed(false),
      onPointerCancel: (_) => _setPressed(false),
      child: AnimatedScale(
        scale: pressed ? widget.pressedScale : 1,
        duration: BulkaMotion.duration(
          context,
          pressed ? BulkaMotion.press : BulkaMotion.fast,
        ),
        curve: pressed ? Easing.standard : BulkaMotion.enterCurve,
        child: widget.child,
      ),
    );
  }
}
