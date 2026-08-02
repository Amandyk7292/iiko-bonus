part of '../main.dart';

class _BrandHeader extends StatelessWidget {
  const _BrandHeader();

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        ColorFiltered(
          colorFilter: ColorFilter.mode(
            context.bulkaColors.brandBrown,
            BlendMode.srcIn,
          ),
          child: Image.asset(
            'assets/brand/bulka_logo.png',
            height: 82,
            fit: BoxFit.contain,
          ),
        ),
        const SizedBox(height: 18),
        Text(
          'login_brand_title'.tr,
          textAlign: TextAlign.center,
          style: TextStyle(
            color: Theme.of(context).colorScheme.onSurface,
            fontFamily: _headingFont,
            fontSize: BulkaTypeScale.pageTitle,
            fontWeight: FontWeight.w400,
          ),
        ),
      ],
    );
  }
}

class _AuthCard extends StatelessWidget {
  const _AuthCard({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    return Container(
      padding: const EdgeInsets.all(22),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        borderRadius: BorderRadius.circular(BulkaRadii.card),
        border: Border.all(color: colors.cardBorder),
        boxShadow: _softShadow,
      ),
      child: child,
    );
  }
}

class _AuthStepHeader extends StatelessWidget {
  const _AuthStepHeader({
    required this.step,
    required this.title,
    required this.subtitle,
  });

  final String step;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
          decoration: BoxDecoration(
            color: _sage.withValues(alpha: 0.12),
            borderRadius: BorderRadius.circular(BulkaRadii.pill),
          ),
          child: Text(
            step,
            style: const TextStyle(
              fontFamily: _headingFont,
              color: _sage,
              fontSize: BulkaTypeScale.caption,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
        const SizedBox(height: 14),
        Text(
          title,
          style: TextStyle(
            fontFamily: _headingFont,
            color: Theme.of(context).colorScheme.onSurface,
            fontSize: BulkaTypeScale.titleLarge,
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(height: 8),
        Text(
          subtitle,
          style: TextStyle(
            color: context.bulkaColors.mutedText,
            fontSize: BulkaTypeScale.body,
            height: 1.45,
          ),
        ),
      ],
    );
  }
}

class _InlineAlert extends StatelessWidget {
  const _InlineAlert({required this.message, required this.icon});

  final String message;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      liveRegion: true,
      label: message,
      child: ExcludeSemantics(
        child: Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: _errorRed.withValues(alpha: 0.08),
            borderRadius: BorderRadius.circular(BulkaRadii.control),
            border: Border.all(color: _errorRed.withValues(alpha: 0.22)),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(icon, color: _errorRed, size: 20),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  message,
                  style: const TextStyle(
                    color: _errorRed,
                    fontSize: BulkaTypeScale.bodySmall,
                    height: 1.35,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _PrimaryButton extends StatelessWidget {
  final VoidCallback? onPressed;
  final String text;
  final bool loading;
  final Color color;
  final Color textColor;
  final IconData? icon;
  final String? iconAsset;

  const _PrimaryButton({
    required this.onPressed,
    required this.text,
    this.loading = false,
    this.color = _bulkaYellow,
    this.textColor = _textDark,
    this.icon,
    this.iconAsset,
  });

  @override
  Widget build(BuildContext context) {
    return GradientButton(
      onPressed: onPressed,
      loading: loading,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          if (iconAsset != null) ...[
            Image.asset(
              iconAsset!,
              width: 22,
              height: 22,
              errorBuilder: (_, _, _) => const _WhatsAppVectorIcon(size: 22),
            ),
            const SizedBox(width: 10),
          ] else if (icon != null) ...[
            Icon(icon, size: 24, color: Colors.white),
            const SizedBox(width: 8),
          ],
          Flexible(
            child: Text(text, maxLines: 1, overflow: TextOverflow.ellipsis),
          ),
        ],
      ),
    );
  }
}

class _WhatsAppVectorIcon extends StatelessWidget {
  final double size;

  const _WhatsAppVectorIcon({this.size = 22});

  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      size: Size(size, size),
      painter: _WhatsAppVectorPainter(),
    );
  }
}

class _WhatsAppVectorPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final double w = size.width;
    final double h = size.height;

    final Paint greenPaint = Paint()
      ..color = const Color(0xFF25D366)
      ..style = PaintingStyle.fill;

    final Path bubblePath = Path();
    bubblePath.addOval(
      Rect.fromCircle(center: Offset(w * 0.52, h * 0.46), radius: w * 0.44),
    );

    final Path tailPath = Path()
      ..moveTo(w * 0.22, h * 0.77)
      ..lineTo(w * 0.08, h * 0.92)
      ..lineTo(w * 0.28, h * 0.85)
      ..close();

    final Path fullBubble = Path.combine(
      PathOperation.union,
      bubblePath,
      tailPath,
    );
    canvas.drawPath(fullBubble, greenPaint);

    final Paint whitePaint = Paint()
      ..color = Colors.white
      ..style = PaintingStyle.stroke
      ..strokeWidth = w * 0.12
      ..strokeCap = StrokeCap.round;

    final Path handsetPath = Path()
      ..moveTo(w * 0.35, h * 0.35)
      ..quadraticBezierTo(w * 0.32, h * 0.45, w * 0.42, h * 0.55)
      ..quadraticBezierTo(w * 0.52, h * 0.65, w * 0.63, h * 0.62);

    canvas.drawPath(handsetPath, whitePaint);

    final Paint whiteFill = Paint()
      ..color = Colors.white
      ..style = PaintingStyle.fill;

    canvas.drawCircle(Offset(w * 0.35, h * 0.35), w * 0.08, whiteFill);
    canvas.drawCircle(Offset(w * 0.63, h * 0.62), w * 0.08, whiteFill);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
