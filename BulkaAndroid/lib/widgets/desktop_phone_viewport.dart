part of '../main.dart';

class BulkaDesktopPhoneViewport extends StatelessWidget {
  const BulkaDesktopPhoneViewport({
    required this.child,
    this.desktopModeOverride,
    super.key,
  });

  static const desktopBreakpoint = 900.0;
  static const phoneContentSize = Size(430, 860);
  static const phoneSafeArea = EdgeInsets.only(top: 10, bottom: 10);
  static const _phoneFrameSize = Size(446, 884);

  final Widget child;

  @visibleForTesting
  final bool? desktopModeOverride;

  @override
  Widget build(BuildContext context) {
    final browserMediaQuery = MediaQuery.of(context);
    final browserSize = browserMediaQuery.size;
    final usePhoneViewport =
        desktopModeOverride ??
        (kIsWeb && browserSize.width >= desktopBreakpoint);

    if (!usePhoneViewport) return child;

    return RepaintBoundary(
      key: const ValueKey('bulka-desktop-backdrop'),
      child: CustomPaint(
        painter: const _BulkaDesktopBackdropPainter(),
        child: Stack(
          fit: StackFit.expand,
          children: [
            if (browserSize.width >= 1180)
              Positioned(
                left: 36,
                top: 0,
                bottom: 0,
                width: (browserSize.width - 540) / 2,
                child: IgnorePointer(
                  child: Center(
                    child: Opacity(
                      opacity: 0.11,
                      child: Image.asset(
                        'assets/brand/bulka_logo.png',
                        width: 230,
                        fit: BoxFit.contain,
                        excludeFromSemantics: true,
                      ),
                    ),
                  ),
                ),
              ),
            Positioned.fill(
              child: Padding(
                padding: const EdgeInsets.all(18),
                child: LayoutBuilder(
                  builder: (context, constraints) {
                    final frameWidth = min(
                      constraints.maxWidth,
                      _phoneFrameSize.width,
                    );
                    final frameHeight = min(
                      constraints.maxHeight,
                      _phoneFrameSize.height,
                    );
                    final contentSize = Size(
                      max(0, frameWidth - 16),
                      max(0, frameHeight - 24),
                    );
                    final phoneMediaQuery = browserMediaQuery.copyWith(
                      size: contentSize,
                      padding: phoneSafeArea,
                      viewPadding: phoneSafeArea,
                      viewInsets: EdgeInsets.zero,
                      systemGestureInsets: EdgeInsets.zero,
                      displayFeatures: const [],
                    );
                    return Center(
                      child: Semantics(
                        container: true,
                        child: SizedBox(
                          key: const ValueKey('bulka-desktop-phone-frame'),
                          width: frameWidth,
                          height: frameHeight,
                          child: DecoratedBox(
                            decoration: BoxDecoration(
                              color: const Color(0xFF2B170F),
                              borderRadius: BorderRadius.circular(42),
                              border: Border.all(
                                color: const Color(0xFFB58A55),
                                width: 1,
                              ),
                              boxShadow: const [
                                BoxShadow(
                                  color: Color(0x382B170F),
                                  blurRadius: 42,
                                  offset: Offset(0, 18),
                                ),
                                BoxShadow(
                                  color: Color(0x14FFFFFF),
                                  blurRadius: 2,
                                  spreadRadius: 1,
                                  offset: Offset(0, -1),
                                ),
                              ],
                            ),
                            child: Stack(
                              children: [
                                Positioned(
                                  top: 6,
                                  left: 0,
                                  right: 0,
                                  child: Center(
                                    child: Container(
                                      width: 54,
                                      height: 4,
                                      decoration: BoxDecoration(
                                        color: const Color(0xFF806454),
                                        borderRadius: BorderRadius.circular(99),
                                      ),
                                    ),
                                  ),
                                ),
                                Positioned(
                                  left: 8,
                                  top: 16,
                                  right: 8,
                                  bottom: 8,
                                  child: ClipRRect(
                                    borderRadius: BorderRadius.circular(34),
                                    child: SizedBox(
                                      key: const ValueKey(
                                        'bulka-desktop-phone-content',
                                      ),
                                      width: contentSize.width,
                                      height: contentSize.height,
                                      child: MediaQuery(
                                        data: phoneMediaQuery,
                                        child: child,
                                      ),
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    );
                  },
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _BulkaDesktopBackdropPainter extends CustomPainter {
  const _BulkaDesktopBackdropPainter();

  @override
  void paint(Canvas canvas, Size size) {
    canvas.drawColor(const Color(0xFFF7F0E4), BlendMode.src);

    final shortestSide = min(size.width, size.height);
    final glowPaint = Paint()..color = const Color(0xFFFFC342).withAlpha(34);
    canvas.drawCircle(
      Offset(size.width * 0.08, size.height * 0.06),
      shortestSide * 0.42,
      glowPaint,
    );

    final ringPaint = Paint()
      ..color = const Color(0xFF6D3317).withAlpha(18)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.4;
    final ringCenter = Offset(size.width * 0.92, size.height * 0.88);
    for (final radiusFactor in const [0.20, 0.31, 0.42, 0.53]) {
      canvas.drawCircle(ringCenter, shortestSide * radiusFactor, ringPaint);
    }

    final accentPaint = Paint()
      ..color = const Color(0xFFD7AD66).withAlpha(28)
      ..style = PaintingStyle.stroke
      ..strokeWidth = shortestSide * 0.035
      ..strokeCap = StrokeCap.round;
    canvas.drawArc(
      Rect.fromCenter(
        center: Offset(size.width * 0.18, size.height * 0.96),
        width: shortestSide * 0.62,
        height: shortestSide * 0.28,
      ),
      pi * 1.08,
      pi * 0.72,
      false,
      accentPaint,
    );
  }

  @override
  bool shouldRepaint(covariant _BulkaDesktopBackdropPainter oldDelegate) {
    return false;
  }
}
