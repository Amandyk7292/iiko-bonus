part of '../main.dart';

enum BulkaNavIconKind { home, catalog, cart, promos, locations, profile }

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
    if (kind == BulkaNavIconKind.locations) {
      return Icon(
        active ? Icons.location_on : Icons.location_on_outlined,
        size: size,
        color: color,
      );
    }
    if (kind == BulkaNavIconKind.catalog) {
      return SizedBox.square(
        dimension: size,
        child: CustomPaint(
          painter: _BulkaOriginalCatalogPainter(color: color, active: active),
        ),
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
      case BulkaNavIconKind.locations:
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

// Google Material Icons: bakery_dining (U+E0C9) and bakery_dining_outlined
// (U+EEB9), Copyright 2019 Google LLC. All Rights Reserved. CC-BY-4.0.
// Extracted from Flutter's bundled MaterialIcons-Regular.otf; the original
// 512-unit vector coordinates are unchanged. This requested legacy artwork
// is isolated to the bottom Catalog tab. Other pastry icons use Bulka's font.
// Attribution and license: assets/brand/catalog-icon-LICENSE.txt.
class _BulkaOriginalCatalogPainter extends CustomPainter {
  const _BulkaOriginalCatalogPainter({
    required this.color,
    required this.active,
  });

  final Color color;
  final bool active;

  static final Path _filled = Path()
    ..moveTo(411, 163)
    ..cubicTo(385, 182, 372, 192, 372, 192)
    ..cubicTo(372, 192, 379, 205, 393, 230)
    ..cubicTo(401, 243, 419, 243, 427, 230)
    ..lineTo(444, 203)
    ..cubicTo(448, 197, 449, 189, 446, 182)
    ..lineTo(441, 172)
    ..cubicTo(436, 160, 422, 156, 411, 163)
    ..close()
    ..moveTo(101, 163)
    ..cubicTo(90, 156, 77, 160, 71, 172)
    ..lineTo(66, 182)
    ..cubicTo(63, 188, 63, 196, 67, 203)
    ..lineTo(85, 230)
    ..cubicTo(93, 242, 111, 242, 119, 230)
    ..cubicTo(133, 205, 140, 192, 140, 192)
    ..cubicTo(140, 192, 127, 182, 101, 163)
    ..close()
    ..moveTo(328, 312)
    ..cubicTo(330, 327, 343, 335, 355, 328)
    ..lineTo(389, 309)
    ..cubicTo(399, 303, 402, 289, 396, 279)
    ..lineTo(352, 192)
    ..lineTo(314, 192)
    ..lineTo(328, 312)
    ..close()
    ..moveTo(184, 312)
    ..lineTo(198, 192)
    ..lineTo(160, 192)
    ..lineTo(115, 279)
    ..cubicTo(110, 290, 113, 304, 123, 309)
    ..lineTo(157, 328)
    ..cubicTo(168, 335, 182, 327, 184, 312)
    ..close()
    ..moveTo(294, 192)
    ..lineTo(218, 192)
    ..lineTo(202, 339)
    ..cubicTo(200, 351, 209, 363, 221, 363)
    ..lineTo(291, 363)
    ..cubicTo(302, 363, 311, 351, 310, 339)
    ..lineTo(294, 192)
    ..close();

  static final Path _outlined = Path()
    ..moveTo(437, 279)
    ..cubicTo(440, 285, 439, 284, 441, 287)
    ..cubicTo(447, 313, 433, 340, 409, 349)
    ..lineTo(366, 367)
    ..cubicTo(356, 370, 345, 371, 336, 369)
    ..cubicTo(333, 376, 329, 383, 324, 388)
    ..cubicTo(314, 399, 300, 405, 285, 405)
    ..lineTo(227, 405)
    ..cubicTo(212, 405, 198, 399, 188, 388)
    ..cubicTo(183, 383, 179, 376, 176, 369)
    ..cubicTo(167, 371, 156, 371, 146, 367)
    ..lineTo(103, 350)
    ..cubicTo(79, 340, 65, 313, 71, 287)
    ..lineTo(75, 279)
    ..cubicTo(23, 180, 21, 180, 21, 163)
    ..cubicTo(21, 143, 31, 125, 48, 115)
    ..cubicTo(78, 96, 101, 112, 133, 128)
    ..lineTo(379, 128)
    ..cubicTo(412, 112, 419, 107, 435, 107)
    ..cubicTo(457, 107, 491, 123, 491, 162)
    ..cubicTo(491, 180, 488, 181, 437, 279)
    ..close()
    ..moveTo(429, 151)
    ..lineTo(393, 169)
    ..lineTo(416, 226)
    ..lineTo(447, 169)
    ..cubicTo(452, 157, 440, 145, 429, 151)
    ..close()
    ..moveTo(322, 171)
    ..lineTo(335, 318)
    ..cubicTo(336, 325, 343, 330, 350, 327)
    ..lineTo(393, 310)
    ..cubicTo(397, 308, 400, 303, 399, 298)
    ..lineTo(348, 171)
    ..lineTo(322, 171)
    ..close()
    ..moveTo(164, 171)
    ..lineTo(113, 298)
    ..cubicTo(112, 303, 115, 308, 119, 310)
    ..lineTo(162, 327)
    ..cubicTo(169, 330, 176, 325, 177, 318)
    ..lineTo(190, 171)
    ..lineTo(164, 171)
    ..close()
    ..moveTo(65, 169)
    ..lineTo(96, 227)
    ..lineTo(119, 169)
    ..lineTo(83, 151)
    ..cubicTo(72, 145, 60, 157, 65, 169)
    ..close()
    ..moveTo(217, 351)
    ..cubicTo(216, 358, 221, 363, 227, 363)
    ..lineTo(285, 363)
    ..cubicTo(291, 363, 296, 358, 296, 351)
    ..lineTo(279, 171)
    ..lineTo(233, 171)
    ..lineTo(217, 351)
    ..close();

  @override
  void paint(Canvas canvas, Size size) {
    canvas.save();
    canvas.translate(0, size.height);
    canvas.scale(size.width / 512, -size.height / 512);
    canvas.drawPath(
      active ? _filled : _outlined,
      Paint()
        ..color = color
        ..style = PaintingStyle.fill,
    );
    canvas.restore();
  }

  @override
  bool shouldRepaint(covariant _BulkaOriginalCatalogPainter oldDelegate) =>
      oldDelegate.color != color || oldDelegate.active != active;
}
