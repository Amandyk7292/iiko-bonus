part of '../main.dart';

class _PurchaseSummary extends StatelessWidget {
  const _PurchaseSummary({
    required this.order,
    required this.onRepeat,
    required this.repeatLoading,
    required this.onSupport,
  });
  final CustomerOrder order;
  final VoidCallback onRepeat;
  final bool repeatLoading;
  final VoidCallback onSupport;

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    String money(num value) => '${formatMoney(value.toDouble())} ₸';
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        automaticallyImplyLeading: false,
        centerTitle: true,
        leading: const SizedBox(width: 48),
        title: Text(
          'order_details_title'.trArgs({'number': order.number}),
          style: const TextStyle(
            fontFamily: _headingFont,
            fontWeight: FontWeight.w700,
            fontSize: 16,
          ),
        ),
        actions: [
          IconButton(
            tooltip: 'close_tooltip'.tr,
            onPressed: () => Navigator.of(context).pop(),
            icon: const Icon(Icons.close_rounded),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(18, 16, 18, 24),
        children: [
          Container(
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(24),
              boxShadow: const [
                BoxShadow(
                  color: Color(0x0C000000),
                  blurRadius: 28,
                  offset: Offset(0, 10),
                ),
              ],
            ),
            child: Column(
              children: [
                for (final item in order.items)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 10),
                    child: Row(
                      children: [
                        if (_asString(
                          item['imageUrl'] ?? item['image_url'],
                        ).isNotEmpty) ...[
                          ClipRRect(
                            borderRadius: BorderRadius.circular(12),
                            child: SizedBox.square(
                              dimension: 58,
                              child: _NetworkImage(
                                url: _asString(
                                  item['imageUrl'] ?? item['image_url'],
                                ),
                                fit: BoxFit.cover,
                              ),
                            ),
                          ),
                          const SizedBox(width: 12),
                        ],
                        Expanded(
                          child: Text(
                            localizedOrderItemName(item),
                            style: const TextStyle(fontSize: 14),
                          ),
                        ),
                        const SizedBox(width: 10),
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            Text(
                              money(
                                _asDouble(item['price']) *
                                    _asInt(item['quantity'], fallback: 1),
                              ),
                              style: const TextStyle(
                                fontSize: 14,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                            if (_asInt(item['quantity'], fallback: 1) > 1)
                              Text(
                                '× ${_asInt(item['quantity'])}',
                                style: TextStyle(
                                  color: colors.mutedText,
                                  fontSize: 12,
                                ),
                              ),
                          ],
                        ),
                      ],
                    ),
                  ),
                const Divider(height: 32),
                _OrderInfoRow(
                  label: 'payment_status_${order.paymentStatus}'.tr,
                  value: money(order.amount),
                  strong: true,
                ),
                if (order.discount > 0)
                  _OrderInfoRow(
                    label: 'checkout_discount'.tr,
                    value: '−${money(order.discount)}',
                  ),
                if (order.paymentStatus == 'refunded' &&
                    order.refundAmount != null)
                  _OrderInfoRow(
                    label: 'orders_refund'.tr,
                    value: money(order.refundAmount!),
                  ),
              ],
            ),
          ),
          if (order.branch.isNotEmpty) ...[
            const SizedBox(height: 24),
            Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                color: const Color(0xFFFBF8F3),
                borderRadius: BorderRadius.circular(24),
              ),
              child: Row(
                children: [
                  const Icon(Icons.location_on_outlined),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      order.branch,
                      style: const TextStyle(fontSize: 14),
                    ),
                  ),
                ],
              ),
            ),
          ],
          const SizedBox(height: 24),
          if (order.receiptUrl?.isNotEmpty == true)
            ListTile(
              contentPadding: const EdgeInsets.symmetric(horizontal: 4),
              leading: const Icon(Icons.receipt_long_outlined),
              title: Text('order_receipt'.tr),
              trailing: const Icon(Icons.chevron_right_rounded),
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) =>
                      PaymentReceiptScreen(receiptUrl: order.receiptUrl!),
                ),
              ),
            ),
          ListTile(
            contentPadding: const EdgeInsets.symmetric(horizontal: 4),
            leading: const Icon(Icons.support_agent_rounded),
            title: Text('order_support'.tr),
            trailing: const Icon(Icons.chevron_right_rounded),
            onTap: onSupport,
          ),
        ],
      ),
      bottomNavigationBar: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.all(18),
          child: FilledButton(
            onPressed: repeatLoading ? null : onRepeat,
            style: FilledButton.styleFrom(
              minimumSize: const Size.fromHeight(56),
              backgroundColor: _bulkaYellow,
              foregroundColor: colors.brandBrown,
            ),
            child: repeatLoading
                ? const SizedBox.square(
                    dimension: 22,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : Text(
                    'purchase_add_to_cart'.tr,
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  ),
          ),
        ),
      ),
    );
  }
}
