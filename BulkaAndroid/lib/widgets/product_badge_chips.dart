part of '../main.dart';

class ProductBadgeChips extends StatelessWidget {
  const ProductBadgeChips({required this.badges, super.key});
  final List<Map<String, dynamic>> badges;
  static const textStyle = TextStyle(
    fontFamily: _descriptionFont,
    fontSize: 12,
    fontWeight: FontWeight.w700,
    height: 1.2,
  );
  @override
  Widget build(BuildContext context) => Wrap(
    spacing: 4,
    runSpacing: 4,
    children: badges
        .where((badge) => !ProductPhotoSticker.isSticker(badge))
        .take(3)
        .map((badge) {
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
              style: textStyle.copyWith(
                color: color('foreground', Colors.white),
              ),
            ),
          );
        })
        .toList(),
  );
}

class ProductPhotoSticker extends StatelessWidget {
  const ProductPhotoSticker({required this.badges, this.size = 80, super.key});
  final List<Map<String, dynamic>> badges;
  final double size;

  static bool isSticker(Map<String, dynamic> badge) =>
      '${badge['imageUrl'] ?? ''}'.trim().isNotEmpty;

  @override
  Widget build(BuildContext context) {
    final stickers = badges.where(isSticker);
    if (stickers.isEmpty) return const SizedBox.shrink();
    final sticker = stickers.first;
    final url = '${sticker['imageUrl']}'.trim();
    if (Uri.tryParse(url)?.scheme != 'https') return const SizedBox.shrink();
    return IgnorePointer(
      child: LayoutBuilder(
        builder: (context, constraints) {
          final extent = min(size, constraints.maxWidth);
          return Align(
            alignment: Alignment.topLeft,
            widthFactor: 1,
            heightFactor: 1,
            child: SizedBox.square(
              dimension: extent,
              child: _NetworkImage(
                key: ValueKey('product-sticker-${sticker['id'] ?? url}'),
                url: url,
                fit: BoxFit.contain,
                semanticLabel: '${sticker['label'] ?? ''}',
                loadingPlaceholder: const SizedBox.shrink(),
                errorPlaceholder: const SizedBox.shrink(),
                animate: false,
              ),
            ),
          );
        },
      ),
    );
  }
}
