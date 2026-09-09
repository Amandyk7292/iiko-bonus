part of '../main.dart';

class PaymentReceiptScreen extends StatefulWidget {
  const PaymentReceiptScreen({required this.receiptUrl, this.api, super.key});
  final String receiptUrl;
  final BulkaApiClient? api;

  @override
  State<PaymentReceiptScreen> createState() => _PaymentReceiptScreenState();
}

class _PaymentReceiptScreenState extends State<PaymentReceiptScreen> {
  late final _api = widget.api ?? BulkaApiClient();
  late Future<PaymentReceipt> _receipt;
  bool _sharing = false;

  @override
  void initState() {
    super.initState();
    _receipt = _api.getPaymentReceipt(widget.receiptUrl);
  }

  @override
  void dispose() {
    if (widget.api == null) _api.dispose();
    super.dispose();
  }

  Future<void> _share(
    PaymentReceipt receipt,
    BuildContext buttonContext,
  ) async {
    if (_sharing) return;
    final box = buttonContext.findRenderObject() as RenderBox?;
    final origin = box == null
        ? null
        : box.localToGlobal(Offset.zero) & box.size;
    setState(() => _sharing = true);
    try {
      final bytes = await buildPaymentReceiptPdf(receipt);
      if (!mounted) return;
      await SharePlus.instance.share(
        ShareParams(
          files: [XFile.fromData(bytes, mimeType: 'application/pdf')],
          fileNameOverrides: ['Bulka-${receipt.documentNumber}.pdf'],
          subject: '${'receipt_title'.tr} ${receipt.documentNumber}',
          sharePositionOrigin: origin,
        ),
      );
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('receipt_share_error'.tr)));
      }
    } finally {
      if (mounted) setState(() => _sharing = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: Colors.white,
    appBar: AppBar(
      title: Text('receipt_title'.tr),
      backgroundColor: Colors.white,
      leading: IconButton(
        tooltip: 'close_tooltip'.tr,
        icon: const Icon(Icons.close_rounded),
        onPressed: () => Navigator.pop(context),
      ),
    ),
    body: SafeArea(
      top: false,
      child: FutureBuilder<PaymentReceipt>(
        future: _receipt,
        builder: (context, snapshot) {
          if (snapshot.hasError) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text('receipt_load_error'.tr, textAlign: TextAlign.center),
                    const SizedBox(height: 16),
                    OutlinedButton(
                      onPressed: () => setState(() {
                        _receipt = _api.getPaymentReceipt(widget.receiptUrl);
                      }),
                      child: Text('retry_btn'.tr),
                    ),
                  ],
                ),
              ),
            );
          }
          final receipt = snapshot.data;
          if (receipt == null) {
            return const Center(child: CircularProgressIndicator());
          }
          return ListView(
            padding: const EdgeInsets.fromLTRB(20, 12, 20, 28),
            children: [
              Center(
                child: Image.asset(
                  'assets/brand/bulka_logo.png',
                  width: 105,
                  height: 65,
                  fit: BoxFit.contain,
                ),
              ),
              const SizedBox(height: 20),
              Text(
                'order_details_title'.trArgs({'number': receipt.orderNumber}),
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.titleLarge,
              ),
              const SizedBox(height: 24),
              _OrderInfoRow(
                label: 'receipt_document'.tr,
                value: receipt.documentNumber,
              ),
              _OrderInfoRow(
                label: 'receipt_date'.tr,
                value: formatDateTime(receipt.transactionAt),
              ),
              if (receipt.isRefund)
                _OrderInfoRow(
                  label: 'receipt_payment'.tr,
                  value: 'orders_refund'.tr,
                ),
              const Divider(height: 32),
              if (receipt.items.isEmpty) Text('receipt_empty'.tr),
              for (final item in receipt.items)
                Padding(
                  padding: const EdgeInsets.only(bottom: 18),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        localizedOrderItemName(item),
                        style: const TextStyle(fontWeight: FontWeight.w600),
                      ),
                      const SizedBox(height: 6),
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              '${_asInt(item['quantity'], fallback: 1)} × ${receipt.money(_asDouble(item['unitPrice']))}',
                            ),
                          ),
                          const SizedBox(width: 12),
                          Text(receipt.money(_asDouble(item['lineTotal']))),
                        ],
                      ),
                    ],
                  ),
                ),
              const Divider(height: 24),
              _OrderInfoRow(
                label: 'receipt_goods'.tr,
                value: receipt.money(receipt.goodsSubtotal),
              ),
              if (receipt.bonusSpent > 0)
                _OrderInfoRow(
                  label: 'checkout_bonus_spent'.tr,
                  value: '−${receipt.money(receipt.bonusSpent)}',
                ),
              if (receipt.discount > 0)
                _OrderInfoRow(
                  label: 'receipt_discount'.tr,
                  value: '−${receipt.money(receipt.discount)}',
                ),
              if (receipt.hasDelivery)
                _OrderInfoRow(
                  label: 'checkout_delivery_fee'.tr,
                  value: receipt.money(receipt.deliveryFee),
                ),
              _OrderInfoRow(
                label: 'receipt_total'.tr,
                value: receipt.money(receipt.amount),
                strong: true,
              ),
              const Divider(height: 32),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Icon(Icons.credit_card_rounded),
                  const SizedBox(width: 12),
                  Expanded(child: Text(receipt.paymentLabel)),
                ],
              ),
              const SizedBox(height: 32),
              Builder(
                builder: (buttonContext) => FilledButton.icon(
                  onPressed: _sharing
                      ? null
                      : () => _share(receipt, buttonContext),
                  icon: const Icon(Icons.ios_share_rounded),
                  label: Text('receipt_share'.tr),
                ),
              ),
            ],
          );
        },
      ),
    ),
  );
}
