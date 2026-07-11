part of '../main.dart';

abstract final class BulkaMotion {
  static const fast = Duration(milliseconds: 160);
  static const standard = Duration(milliseconds: 240);
  static const emphasized = Duration(milliseconds: 320);

  static bool reduced(BuildContext context) {
    final media = MediaQuery.maybeOf(context);
    return media?.disableAnimations == true ||
        media?.accessibleNavigation == true;
  }

  static Duration duration(BuildContext context, Duration normal) {
    return reduced(context) ? Duration.zero : normal;
  }

  static Future<void> selection() => HapticFeedback.selectionClick();

  static Future<void> lightImpact() => HapticFeedback.lightImpact();

  static Future<void> confirm() => HapticFeedback.mediumImpact();
}

class BulkaPageTransitionsBuilder extends PageTransitionsBuilder {
  const BulkaPageTransitionsBuilder();

  @override
  Widget buildTransitions<T>(
    PageRoute<T> route,
    BuildContext context,
    Animation<double> animation,
    Animation<double> secondaryAnimation,
    Widget child,
  ) {
    if (BulkaMotion.reduced(context)) return child;

    final curved = CurvedAnimation(
      parent: animation,
      curve: Curves.easeOutCubic,
      reverseCurve: Curves.easeInCubic,
    );
    return FadeTransition(
      opacity: curved,
      child: SlideTransition(
        position: Tween<Offset>(
          begin: const Offset(0.045, 0),
          end: Offset.zero,
        ).animate(curved),
        child: child,
      ),
    );
  }
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
    return Listener(
      onPointerDown: (_) => _setPressed(true),
      onPointerUp: (_) => _setPressed(false),
      onPointerCancel: (_) => _setPressed(false),
      child: AnimatedScale(
        scale: !reduced && _pressed ? widget.pressedScale : 1,
        duration: BulkaMotion.duration(context, BulkaMotion.fast),
        curve: Curves.easeOutCubic,
        child: widget.child,
      ),
    );
  }
}
