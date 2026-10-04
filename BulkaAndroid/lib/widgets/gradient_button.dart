part of '../main.dart';

class GradientButton extends StatelessWidget {
  final VoidCallback? onPressed;
  final Widget child;
  final bool loading;
  final EdgeInsetsGeometry? padding;
  final double height;
  final double borderRadius;
  final Gradient? gradient;
  final Color foregroundColor;
  final Color? borderColor;
  final List<BoxShadow>? shadows;

  const GradientButton({
    super.key,
    required this.onPressed,
    required this.child,
    this.loading = false,
    this.padding,
    this.height = 58,
    this.borderRadius = BulkaRadii.card,
    this.gradient,
    this.foregroundColor = const Color(0xFF542A12),
    this.borderColor,
    this.shadows,
  });

  @override
  Widget build(BuildContext context) {
    final disabled = loading || onPressed == null;
    final effectiveOnPressed = loading || onPressed == null
        ? null
        : () {
            BulkaMotion.lightImpact();
            onPressed!();
          };
    return BulkaPressScale(
      enabled: effectiveOnPressed != null,
      child: ConstrainedBox(
        constraints: BoxConstraints(
          minWidth: double.infinity,
          minHeight: height,
        ),
        child: BulkaButtonSurface(
          disabled: disabled,
          radius: borderRadius,
          gradient: gradient,
          borderColor: borderColor,
          shadows: shadows ?? BulkaButtonSurface.softShadow,
          child: FilledButton(
            onPressed: effectiveOnPressed,
            style: FilledButton.styleFrom(
              backgroundColor: Colors.transparent,
              disabledBackgroundColor: Colors.transparent,
              shadowColor: Colors.transparent,
              foregroundColor: foregroundColor,
              padding:
                  padding ??
                  const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
              minimumSize: Size(0, height),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(borderRadius),
              ),
            ),
            child: BulkaMotionSwitcher(
              duration: BulkaMotion.fast,
              offset: Offset.zero,
              scale: 0.88,
              child: loading
                  ? SizedBox(
                      key: ValueKey('gradient-button-loading'),
                      height: 24,
                      width: 24,
                      child: CircularProgressIndicator(
                        strokeWidth: 2.5,
                        color: _bulkaBrown.withValues(alpha: 0.65),
                      ),
                    )
                  : KeyedSubtree(
                      key: const ValueKey('gradient-button-content'),
                      child: DefaultTextStyle(
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontFamily: _headingFont,
                          color: disabled
                              ? _bulkaBrown.withValues(alpha: 0.45)
                              : foregroundColor,
                          fontSize: BulkaTypeScale.titleSmall,
                          fontWeight: FontWeight.w500,
                        ),
                        child: child,
                      ),
                    ),
            ),
          ),
        ),
      ),
    );
  }
}
