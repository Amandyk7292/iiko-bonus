part of '../main.dart';

enum BulkaNavIconKind { home, catalog, cart, promos, profile }

class BulkaNavIcon extends StatelessWidget {
  const BulkaNavIcon({
    required this.kind,
    required this.color,
    this.size = 24,
    this.active = false,
    super.key,
  });

  final BulkaNavIconKind kind;
  final Color color;
  final double size;
  final bool active;

  @override
  Widget build(BuildContext context) {
    if (kind == BulkaNavIconKind.catalog) {
      return Icon(
        active ? Icons.bakery_dining : Icons.bakery_dining_outlined,
        size: size,
        color: color,
      );
    }
    return SizedBox.square(
      dimension: size,
      child: CustomPaint(
        painter: _BulkaNavIconPainter(kind: kind, color: color, active: active),
      ),
    );
  }
}

class _BulkaNavIconPainter extends CustomPainter {
  const _BulkaNavIconPainter({
    required this.kind,
    required this.color,
    required this.active,
  });

  final BulkaNavIconKind kind;
  final Color color;
  final bool active;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.save();
    canvas.scale(size.width / 24, size.height / 24);
    final stroke = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = active ? 2.15 : 1.85
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;

    switch (kind) {
      case BulkaNavIconKind.home:
        _paintHome(canvas, stroke);
        break;
      case BulkaNavIconKind.catalog:
        _paintCroissant(canvas, stroke);
        break;
      case BulkaNavIconKind.cart:
        _paintBag(canvas, stroke);
        break;
      case BulkaNavIconKind.promos:
        _paintGift(canvas, stroke);
        break;
      case BulkaNavIconKind.profile:
        _paintProfile(canvas, stroke);
        break;
    }
    canvas.restore();
  }

  void _paintHome(Canvas canvas, Paint paint) {
    final shell = Path()
      ..moveTo(3.8, 10.7)
      ..quadraticBezierTo(3.8, 9.9, 4.5, 9.3)
      ..lineTo(10.8, 4.2)
      ..quadraticBezierTo(12, 3.3, 13.2, 4.2)
      ..lineTo(19.5, 9.3)
      ..quadraticBezierTo(20.2, 9.9, 20.2, 10.7)
      ..lineTo(19.4, 19.1)
      ..quadraticBezierTo(19.3, 20.2, 18.1, 20.2)
      ..lineTo(5.9, 20.2)
      ..quadraticBezierTo(4.7, 20.2, 4.6, 19.1)
      ..close();
    canvas.drawPath(shell, paint);
    canvas.drawPath(
      Path()
        ..moveTo(9.2, 20)
        ..lineTo(9.2, 14.1)
        ..quadraticBezierTo(9.2, 13.1, 10.2, 13.1)
        ..lineTo(13.8, 13.1)
        ..quadraticBezierTo(14.8, 13.1, 14.8, 14.1)
        ..lineTo(14.8, 20),
      paint,
    );
    canvas.drawLine(const Offset(7.2, 9.8), const Offset(16.8, 9.8), paint);
  }

  void _paintCroissant(Canvas canvas, Paint paint) {
    final croissant = Path()
      ..moveTo(3.2, 15.1)
      ..cubicTo(4.4, 19.4, 8.3, 20.4, 12, 20.4)
      ..cubicTo(15.7, 20.4, 19.6, 19.4, 20.8, 15.1)
      ..cubicTo(18.2, 16.2, 16.5, 12.8, 16.1, 8.1)
      ..cubicTo(14.7, 9.3, 13.3, 9.9, 12, 9.9)
      ..cubicTo(10.7, 9.9, 9.3, 9.3, 7.9, 8.1)
      ..cubicTo(7.5, 12.8, 5.8, 16.2, 3.2, 15.1)
      ..close();
    canvas.drawPath(croissant, paint);
    canvas.drawPath(
      Path()
        ..moveTo(7.9, 8.5)
        ..quadraticBezierTo(8.2, 13.2, 9.4, 19.3),
      paint,
    );
    canvas.drawPath(
      Path()
        ..moveTo(12, 10.1)
        ..lineTo(12, 20),
      paint,
    );
    canvas.drawPath(
      Path()
        ..moveTo(16.1, 8.5)
        ..quadraticBezierTo(15.8, 13.2, 14.6, 19.3),
      paint,
    );
  }

  void _paintBag(Canvas canvas, Paint paint) {
    final bag = Path()
      ..moveTo(5.2, 9)
      ..quadraticBezierTo(5.2, 8.2, 6, 8.2)
      ..lineTo(18, 8.2)
      ..quadraticBezierTo(18.8, 8.2, 18.8, 9)
      ..lineTo(19.6, 19.2)
      ..quadraticBezierTo(19.7, 20.4, 18.5, 20.4)
      ..lineTo(5.5, 20.4)
      ..quadraticBezierTo(4.3, 20.4, 4.4, 19.2)
      ..close();
    canvas.drawPath(bag, paint);
    canvas.drawPath(
      Path()
        ..moveTo(8.4, 9.5)
        ..lineTo(8.4, 6.8)
        ..cubicTo(8.4, 4.6, 10, 3.6, 12, 3.6)
        ..cubicTo(14, 3.6, 15.6, 4.6, 15.6, 6.8)
        ..lineTo(15.6, 9.5),
      paint,
    );
    canvas.drawLine(const Offset(8.4, 12), const Offset(8.4, 13.1), paint);
    canvas.drawLine(const Offset(15.6, 12), const Offset(15.6, 13.1), paint);
  }

  void _paintGift(Canvas canvas, Paint paint) {
    canvas.drawRRect(
      RRect.fromRectAndRadius(
        const Rect.fromLTWH(4.2, 9.4, 15.6, 11),
        const Radius.circular(BulkaRadii.small),
      ),
      paint,
    );
    canvas.drawRRect(
      RRect.fromRectAndRadius(
        const Rect.fromLTWH(3.5, 7.2, 17, 4),
        const Radius.circular(BulkaRadii.small),
      ),
      paint,
    );
    canvas.drawLine(const Offset(12, 7.2), const Offset(12, 20.4), paint);
    canvas.drawPath(
      Path()
        ..moveTo(11.8, 7)
        ..cubicTo(10.8, 3.4, 7.2, 3.2, 7.1, 5.2)
        ..cubicTo(7, 6.8, 9.2, 7.2, 11.8, 7),
      paint,
    );
    canvas.drawPath(
      Path()
        ..moveTo(12.2, 7)
        ..cubicTo(13.2, 3.4, 16.8, 3.2, 16.9, 5.2)
        ..cubicTo(17, 6.8, 14.8, 7.2, 12.2, 7),
      paint,
    );
  }

  void _paintProfile(Canvas canvas, Paint paint) {
    canvas.drawCircle(const Offset(12, 7.1), 3.7, paint);
    canvas.drawPath(
      Path()
        ..moveTo(4.3, 20.1)
        ..cubicTo(4.8, 15.7, 7.7, 13.5, 12, 13.5)
        ..cubicTo(16.3, 13.5, 19.2, 15.7, 19.7, 20.1)
        ..quadraticBezierTo(16, 21.1, 12, 21.1)
        ..quadraticBezierTo(8, 21.1, 4.3, 20.1),
      paint,
    );
  }

  @override
  bool shouldRepaint(covariant _BulkaNavIconPainter oldDelegate) =>
      oldDelegate.kind != kind ||
      oldDelegate.color != color ||
      oldDelegate.active != active;
}
