part of '../main.dart';

class GradientButton extends StatelessWidget {
  final VoidCallback? onPressed;
  final Widget child;
  final bool loading;
  final EdgeInsetsGeometry? padding;
  final double height;
  final double borderRadius;

  const GradientButton({
    super.key,
    required this.onPressed,
    required this.child,
    this.loading = false,
    this.padding,
    this.height = 58,
    this.borderRadius = 28,
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
      child: SizedBox(
        width: double.infinity,
        height: height,
        child: AnimatedContainer(
          duration: BulkaMotion.duration(context, BulkaMotion.fast),
          curve: BulkaMotion.standardCurve,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(borderRadius),
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: disabled
                  ? [const Color(0xFFE0E0E0), const Color(0xFFBDBDBD)]
                  : [
                      const Color(0xFFFFD54F),
                      const Color(0xFFFFB300),
                      const Color(0xFFFFA000),
                    ],
            ),
            boxShadow: disabled
                ? null
                : [
                    const BoxShadow(
                      color: Color(0x33FFA000),
                      blurRadius: 8,
                      offset: Offset(0, 4),
                    ),
                  ],
          ),
          child: FilledButton(
            onPressed: effectiveOnPressed,
            style: FilledButton.styleFrom(
              backgroundColor: Colors.transparent,
              shadowColor: Colors.transparent,
              foregroundColor: Colors.white,
              padding: padding,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(borderRadius),
              ),
            ),
            child: BulkaMotionSwitcher(
              duration: BulkaMotion.fast,
              offset: Offset.zero,
              scale: 0.88,
              child: loading
                  ? const SizedBox(
                      key: ValueKey('gradient-button-loading'),
                      height: 24,
                      width: 24,
                      child: CircularProgressIndicator(
                        strokeWidth: 2.5,
                        color: Colors.white,
                      ),
                    )
                  : KeyedSubtree(
                      key: const ValueKey('gradient-button-content'),
                      child: DefaultTextStyle(
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 18,
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
