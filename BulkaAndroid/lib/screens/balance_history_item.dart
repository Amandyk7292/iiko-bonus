part of '../main.dart';

class TransactionCard extends StatelessWidget {
  const TransactionCard({required this.transaction, super.key});

  final BonusTransaction transaction;

  void _showReceiptDetails(BuildContext context) {
    if (transaction.items == null || transaction.items!.isEmpty) return;

    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.white,
      isScrollControlled: true,
      builder: (context) {
        return Container(
          decoration: const BoxDecoration(
            color: _cream,
            borderRadius: BorderRadius.vertical(
              top: Radius.circular(BulkaRadii.card),
            ),
          ),
          padding: EdgeInsets.fromLTRB(
            24,
            24,
            24,
            24 + MediaQuery.paddingOf(context).bottom,
          ),
          constraints: BoxConstraints(
            maxHeight: MediaQuery.of(context).size.height * 0.8,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: _almond,
                    borderRadius: BorderRadius.circular(BulkaRadii.small),
                  ),
                ),
              ),
              const SizedBox(height: 24),
              Row(
                children: [
                  Expanded(
                    child: Text(
                      'order_details'.tr,
                      style: const TextStyle(
                        color: _textDark,
                        fontFamily: _headingFont,
                        fontSize: BulkaTypeScale.title,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                  IconButton(
                    onPressed: () => Navigator.of(context).pop(),
                    tooltip: 'close_tooltip'.tr,
                    icon: const Icon(Icons.close_rounded),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              Expanded(
                child: ListView.separated(
                  itemCount: transaction.items!.length,
                  separatorBuilder: (_, _) =>
                      Divider(color: _almond.withValues(alpha: 0.3)),
                  itemBuilder: (context, index) {
                    final item = _asMap(transaction.items![index]);
                    final name = localizedOrderItemName(item);
                    final qty = item['amount'] ?? item['quantity'] ?? 1;
                    final price = item['sum'] ?? item['price'] ?? 0;
                    return Padding(
                      padding: const EdgeInsets.symmetric(vertical: 8),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(
                            child: Text(
                              '$name x$qty',
                              style: const TextStyle(
                                color: _textDark,
                                fontSize: BulkaTypeScale.body,
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Text(
                            '${formatMoney(double.tryParse(price.toString()) ?? 0)} ₸',
                            style: const TextStyle(
                              color: _textDark,
                              fontSize: BulkaTypeScale.body,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ],
                      ),
                    );
                  },
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final earning = transaction.isEarning;
    final colors = context.bulkaColors;
    final color = earning ? colors.brandBrown : _errorRed;
    final hasItems = transaction.items?.isNotEmpty ?? false;
    final date = DateTime.tryParse(transaction.timestamp)?.toLocal();
    final type = transaction.type.toLowerCase();
    final purchase = type == 'deposit' || type == 'earning';
    final orderId = transaction.orderId?.trim() ?? '';
    // Only customer-facing numbers belong in the description, never internal UUIDs.
    final orderNumber = RegExp(r'^#?\d+$').hasMatch(orderId)
        ? orderId.replaceFirst('#', '')
        : '';
    final description = purchase
        ? (orderNumber.isEmpty
              ? 'balance_purchase_credit'.tr
              : 'balance_purchase_credit_number'.trArgs({
                  'number': orderNumber,
                }))
        : localizeTransactionType(transaction.type, isEarning: earning);
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: hasItems ? () => _showReceiptDetails(context) : null,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 4),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 48,
                height: 48,
                decoration: BoxDecoration(
                  color: earning
                      ? const Color(0xFFFFF1CA)
                      : _errorRed.withValues(alpha: 0.08),
                  shape: BoxShape.circle,
                ),
                child: Icon(
                  earning ? Icons.add_rounded : Icons.remove_rounded,
                  color: color,
                  size: 23,
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '${earning ? '+' : '−'}${formatMoney(transaction.amount.abs())} ${'cart_points'.tr}',
                      style: TextStyle(
                        color: color,
                        fontSize: 18,
                        height: 1.2,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      description,
                      style: TextStyle(
                        color: colors.brandBrown,
                        fontSize: 15,
                        height: 1.35,
                      ),
                    ),
                    if (date != null) ...[
                      const SizedBox(height: 8),
                      Text(
                        MaterialLocalizations.of(context).formatTimeOfDay(
                          TimeOfDay.fromDateTime(date),
                          alwaysUse24HourFormat: true,
                        ),
                        style: TextStyle(
                          color: colors.mutedText,
                          fontSize: 12,
                          height: 1.3,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              if (hasItems) ...[
                const SizedBox(width: 8),
                Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: Icon(
                    Icons.chevron_right_rounded,
                    size: 20,
                    color: colors.mutedText,
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
