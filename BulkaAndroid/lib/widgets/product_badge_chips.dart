part of '../main.dart';

class ProductBadgeChips extends StatelessWidget {
  const ProductBadgeChips({required this.badges, super.key});
  final List<Map<String, dynamic>> badges;
  @override
  Widget build(BuildContext context) => Wrap(
    spacing: 4,
    runSpacing: 4,
    children: badges.take(3).map((badge) {
      Color color(String key, Color fallback) {
        final value = '${badge[key] ?? ''}';
        return RegExp(r'^#[0-9a-fA-F]{6}$').hasMatch(value)
            ? Color(0xFF000000 | int.parse(value.substring(1), radix: 16))
            : fallback;
      }

      return Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        decoration: BoxDecoration(
          color: color('background', const Color(0xFF782B0E)),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Text(
          '${badge['label'] ?? ''}',
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            color: color('foreground', Colors.white),
            fontSize: 12,
            fontWeight: FontWeight.w700,
          ),
        ),
      );
    }).toList(),
  );
}
