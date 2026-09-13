part of '../main.dart';

class _CartSuggestion {
  const _CartSuggestion({
    required this.id,
    required this.name,
    required this.price,
    required this.imageUrl,
  });

  final String id;
  final String name;
  final int price;
  final String imageUrl;
}

class _CartPopularProductCard extends StatelessWidget {
  const _CartPopularProductCard({required this.product, required this.onTap});

  final _CartSuggestion product;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    return SizedBox(
      width: 148,
      child: Semantics(
        button: true,
        label: '${product.name}. ${'cart_popular_open'.tr}',
        child: BulkaPressScale(
          child: Material(
            color: Colors.transparent,
            child: InkWell(
              key: ValueKey('cart-popular-product-${product.id}'),
              onTap: onTap,
              borderRadius: BorderRadius.circular(BulkaRadii.card),
              child: Ink(
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.surface,
                  borderRadius: BorderRadius.circular(BulkaRadii.card),
                  border: Border.all(
                    color: colors.cardBorder,
                    width: BulkaStrokes.hairline,
                  ),
                  boxShadow: BulkaShadows.card,
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Expanded(
                      child: ClipRRect(
                        borderRadius: const BorderRadius.vertical(
                          top: Radius.circular(BulkaRadii.card),
                        ),
                        child: product.imageUrl.trim().isEmpty
                            ? ColoredBox(
                                color: colors.disabledSurface,
                                child: Icon(
                                  Icons.bakery_dining_outlined,
                                  color: colors.goldSoft,
                                  size: 42,
                                ),
                              )
                            : _NetworkImage(
                                url: product.imageUrl,
                                fit: BoxFit.cover,
                              ),
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(12, 10, 10, 11),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            product.name,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: _textDark,
                              fontSize: BulkaTypeScale.bodySmall,
                              height: 1.18,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          const SizedBox(height: 5),
                          Row(
                            children: [
                              Expanded(
                                child: Text(
                                  '${_formatCartMoney(product.price)} ₸',
                                  style: const TextStyle(
                                    color: _textDark,
                                    fontFamily: _headingFont,
                                    fontSize: BulkaTypeScale.bodySmall,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                              ),
                              const Icon(
                                Icons.arrow_forward_rounded,
                                color: _textDark,
                                size: 18,
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

String _newCheckoutId() {
  final random = Random.secure();
  final bytes = List<int>.generate(16, (_) => random.nextInt(256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  final hex = bytes
      .map((value) => value.toRadixString(16).padLeft(2, '0'))
      .join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-'
      '${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
}
