part of '../main.dart';

enum BulkaButtonTone { primary, secondary, choice }

/// A quiet, opaque finish shared by actions and custom touch controls.
class BulkaButtonSurface extends StatelessWidget {
  const BulkaButtonSurface({
    required this.child,
    this.tone = BulkaButtonTone.primary,
    this.disabled = false,
    this.focused = false,
    this.pressed = false,
    this.radius = BulkaRadii.control,
    this.gradient,
    this.baseColor,
    this.foregroundColor,
    this.borderColor,
    this.shadows,
    this.ink = false,
    super.key,
  });

  final Widget child;
  final BulkaButtonTone tone;
  final bool disabled;
  final bool focused;
  final bool pressed;
  final double radius;
  final Gradient? gradient;
  final Color? baseColor;
  final Color? foregroundColor;
  final Color? borderColor;
  final List<BoxShadow>? shadows;
  final bool ink;

  static const goldGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [Color(0xFFFFE19A), Color(0xFFFFCA46), Color(0xFFF5B31F)],
    stops: [0, 0.48, 1],
  );
  static const ivoryGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [Color(0xFFFFFFFD), Color(0xFFFFFAEF), Color(0xFFF5EBD8)],
    stops: [0, 0.6, 1],
  );
  static const chocolateGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [Color(0xFF754A34), Color(0xFF5A301D), Color(0xFF472314)],
    stops: [0, 0.46, 1],
  );
  static const disabledGradient = LinearGradient(
    begin: Alignment.topCenter,
    end: Alignment.bottomCenter,
    colors: [Color(0xFFF2EDE4), Color(0xFFE7E1D7)],
  );
  static const softShadow = [
    BoxShadow(
      color: Color(0x12532814),
      blurRadius: 14,
      spreadRadius: -5,
      offset: Offset(0, 5),
    ),
  ];

  Gradient get _finish {
    if (disabled) return disabledGradient;
    if (gradient != null) return gradient!;
    final base = baseColor;
    if (base == _bulkaBrown) return chocolateGradient;
    if (base == Colors.white) return ivoryGradient;
    if (base != null && base != _bulkaYellow && base != Colors.white) {
      // Local danger/success/payment colors remain the semantic base color.
      final lightLabel =
          (foregroundColor ?? _bulkaBrown).computeLuminance() >
          base.computeLuminance();
      return LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: [
          lightLabel ? base : Color.lerp(base, Colors.white, 0.10)!,
          base,
          lightLabel ? Color.lerp(base, Colors.black, 0.06)! : base,
        ],
        stops: const [0, 0.52, 1],
      );
    }
    return switch (tone) {
      BulkaButtonTone.primary => goldGradient,
      BulkaButtonTone.secondary => ivoryGradient,
      BulkaButtonTone.choice => chocolateGradient,
    };
  }

  @override
  Widget build(BuildContext context) {
    final border = disabled
        ? const Color(0xFFDAD2C5)
        : focused
        ? _bulkaBrown
        : borderColor ??
              (tone == BulkaButtonTone.choice
                  ? const Color(0xFF8C634D)
                  : const Color(0xFFE2C995));
    final decoration = BoxDecoration(
      borderRadius: BorderRadius.circular(radius),
      gradient: _finish,
      border: Border.all(
        color: border,
        width: focused ? 1.6 : BulkaStrokes.hairline,
      ),
      boxShadow: disabled || pressed ? null : shadows,
    );
    // Ink keeps Material focus/press feedback above the painted surface.
    return ink
        ? Ink(decoration: decoration, child: child)
        : DecoratedBox(decoration: decoration, child: child);
  }
}

Widget _bulkaButtonBackground(
  BuildContext context,
  Set<WidgetState> states,
  Widget? child,
  BulkaButtonTone tone,
) {
  final widget = context.widget;
  final localStyle = widget is ButtonStyleButton ? widget.style : null;
  final localColor = localStyle?.backgroundColor?.resolve(states);
  final theme = Theme.of(context);
  final inheritedStyle = switch (widget) {
    FilledButton() => theme.filledButtonTheme.style,
    ElevatedButton() => theme.elevatedButtonTheme.style,
    OutlinedButton() => theme.outlinedButtonTheme.style,
    _ => null,
  };
  final inheritedForeground =
      inheritedStyle?.foregroundColor?.resolve(states) ??
      (widget is FilledButton
          ? theme.colorScheme.onPrimary
          : theme.colorScheme.primary);
  // Existing composite/gradient controls intentionally own their background.
  if (localColor != null && localColor.a == 0) {
    return child ?? const SizedBox.shrink();
  }
  final shape =
      localStyle?.shape?.resolve(states) ??
      inheritedStyle?.shape?.resolve(states);
  final side =
      localStyle?.side?.resolve(states) ??
      inheritedStyle?.side?.resolve(states);
  final radius = shape is CircleBorder
      ? BulkaRadii.pill
      : shape is RoundedRectangleBorder
      ? shape.borderRadius.resolve(Directionality.of(context)).topLeft.x
      : BulkaRadii.control;
  return BulkaButtonSurface(
    tone: tone,
    disabled: states.contains(WidgetState.disabled),
    focused: states.contains(WidgetState.focused),
    pressed: states.contains(WidgetState.pressed),
    radius: radius,
    baseColor: localColor,
    foregroundColor:
        localStyle?.foregroundColor?.resolve(states) ?? inheritedForeground,
    borderColor: side?.style == BorderStyle.none
        ? Colors.transparent
        : side?.color,
    ink: true,
    child: child ?? const SizedBox.shrink(),
  );
}

Widget _bulkaPrimaryButtonBackground(
  BuildContext context,
  Set<WidgetState> states,
  Widget? child,
) => _bulkaButtonBackground(context, states, child, BulkaButtonTone.primary);

Widget _bulkaSecondaryButtonBackground(
  BuildContext context,
  Set<WidgetState> states,
  Widget? child,
) => _bulkaButtonBackground(context, states, child, BulkaButtonTone.secondary);

Widget _bulkaChoiceButtonBackground(
  BuildContext context,
  Set<WidgetState> states,
  Widget? child,
) => _bulkaButtonBackground(context, states, child, BulkaButtonTone.choice);
