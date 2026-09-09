part of '../main.dart';

class _CheckoutDeliveryUnavailable extends StatelessWidget {
  const _CheckoutDeliveryUnavailable();

  @override
  Widget build(BuildContext context) {
    final color = context.bulkaColors.mutedText;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(Icons.info_outline_rounded, size: 18, color: color),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            'checkout_delivery_unavailable'.tr,
            style: TextStyle(
              color: color,
              fontSize: BulkaTypeScale.bodySmall,
              height: 1.35,
            ),
          ),
        ),
      ],
    );
  }
}

class _CheckoutQuoteError extends StatelessWidget {
  const _CheckoutQuoteError({required this.message, required this.onRetry});

  final String message;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) => Column(
    children: [
      Semantics(
        liveRegion: true,
        child: Text(
          message,
          key: const ValueKey('checkout-quote-error'),
          style: TextStyle(color: Theme.of(context).colorScheme.error),
          textAlign: TextAlign.center,
        ),
      ),
      TextButton(onPressed: onRetry, child: Text('checkout_retry_quote'.tr)),
      const SizedBox(height: 8),
    ],
  );
}

class _OnlineOrderingDisabledNotice extends StatelessWidget {
  const _OnlineOrderingDisabledNotice();

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    return Semantics(
      liveRegion: true,
      child: Container(
        key: const ValueKey('checkout-online-ordering-disabled'),
        width: double.infinity,
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: colors.danger.withValues(alpha: 0.06),
          border: Border.all(color: colors.danger.withValues(alpha: 0.3)),
          borderRadius: BorderRadius.circular(BulkaRadii.control),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(Icons.lock_outline_rounded, size: 22, color: colors.danger),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'checkout_online_ordering_disabled_title'.tr,
                    style: TextStyle(
                      color: colors.danger,
                      fontFamily: _headingFont,
                      fontSize: BulkaTypeScale.body,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'checkout_online_ordering_disabled'.tr,
                    style: TextStyle(
                      color: colors.mutedText,
                      fontSize: BulkaTypeScale.bodySmall,
                      height: 1.45,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
