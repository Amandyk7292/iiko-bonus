part of '../main.dart';

class OrdersScreen extends StatefulWidget {
  const OrdersScreen({
    required this.api,
    required this.customer,
    this.transactions = const [],
    this.onExplore,
    super.key,
  });

  final BulkaApiClient api;
  final Customer customer;
  final List<BonusTransaction> transactions;
  final VoidCallback? onExplore;

  @override
  State<OrdersScreen> createState() => _OrdersScreenState();
}

class _OrdersScreenState extends State<OrdersScreen> {
  bool _isCheckingOut = false;

  void _showSuccessDialog(BuildContext context) {
    context.read<CartProvider>().clear();
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('success'.tr, style: const TextStyle(fontFamily: _headingFont)),
        content: Text('Ваш заказ успешно оформлен!', style: const TextStyle(fontSize: 16)),
        actions: [
          TextButton(
            onPressed: () {
              Navigator.pop(context);
              if (widget.onExplore != null) widget.onExplore!();
            },
            child: const Text('OK', style: TextStyle(color: _bulkaYellow, fontWeight: FontWeight.w700)),
          ),
        ],
      ),
    );
  }

  Future<void> _handleCheckout(BuildContext context, CartProvider cart) async {
    if (_isCheckingOut || cart.items.isEmpty) return;
    setState(() => _isCheckingOut = true);
    try {
      await widget.api.createKaspiPayment(
        phone: widget.customer.phone,
        amount: cart.totalAmount.toDouble(),
        cartItems: cart.items.values.map((i) => {
          'id': i.id,
          'name': i.name,
          'price': i.price,
          'quantity': i.quantity,
        }).toList(),
      );
      if (!mounted) return;
      _showSuccessDialog(context);
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(error.toString(), style: const TextStyle(fontFamily: _headingFont))),
      );
    } finally {
      if (mounted) {
        setState(() => _isCheckingOut = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final cart = context.watch<CartProvider>();
    
    return Scaffold(
      appBar: AppBar(
        automaticallyImplyLeading: false,
        title: Text(
          'nav_cart'.tr,
          style: const TextStyle(
            fontFamily: _headingFont,
            fontWeight: FontWeight.w400,
          ),
        ),
      ),
      body: cart.items.isEmpty ? _buildEmptyState(context) : _buildCartItems(context, cart),
    );
  }

  Widget _buildEmptyState(BuildContext context) {
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(
              width: 220,
              height: 140,
              child: Image.asset(
                'assets/brand/bulka_logo.png',
                fit: BoxFit.contain,
                errorBuilder: (context, error, stackTrace) => const Icon(
                  Icons.shopping_bag_rounded,
                  size: 80,
                  color: _caramel,
                ),
              ),
            ),
            const SizedBox(height: 24),
            Text(
              'cart_empty_title'.tr,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: _textDark,
                fontFamily: _headingFont,
                fontSize: 28,
                fontWeight: FontWeight.w400,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'cart_empty_sub'.tr,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: _textDark,
                fontFamily: _headingFont,
                fontSize: 22,
                fontWeight: FontWeight.w400,
              ),
            ),
            const SizedBox(height: 32),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 36),
              child: GradientButton(
                onPressed:
                    widget.onExplore ??
                    () {
                      Navigator.of(context).push<void>(
                        MaterialPageRoute(
                          builder: (_) => const LocationsScreen(),
                        ),
                      );
                    },
                child: Text(
                  'cart_action'.tr,
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildCartItems(BuildContext context, CartProvider cart) {
    final colors = context.bulkaColors;
    final itemsList = cart.items.values.toList();
    
    return Column(
      children: [
        Expanded(
          child: ListView.separated(
            padding: EdgeInsets.fromLTRB(16, 16, 16, BulkaLayout.bottomNavContentInset(context) + 16),
            itemCount: itemsList.length,
            separatorBuilder: (context, index) => const SizedBox(height: 12),
            itemBuilder: (context, index) {
              final item = itemsList[index];
              return Card(
                color: _cream,
                elevation: 0,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                  side: BorderSide(color: _almond.withValues(alpha: 0.45)),
                ),
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Row(
                    children: [
                      ClipRRect(
                        borderRadius: BorderRadius.circular(12),
                        child: SizedBox(
                          width: 70,
                          height: 70,
                          child: _NetworkImage(
                            url: item.imageUrl,
                            fit: BoxFit.cover,
                          ),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              item.name,
                              style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: _textDark),
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                            ),
                            const SizedBox(height: 8),
                            Text(
                              '${item.price} ₸',
                              style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: colors.priceGold),
                            ),
                          ],
                        ),
                      ),
                      Row(
                        children: [
                          IconButton(
                            onPressed: () => cart.setQuantity(item.id, item.quantity - 1),
                            icon: const Icon(Icons.remove_circle_outline, color: _caramel),
                          ),
                          Text('${item.quantity}', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                          IconButton(
                            onPressed: () => cart.setQuantity(item.id, item.quantity + 1),
                            icon: const Icon(Icons.add_circle_outline, color: _caramel),
                          ),
                        ],
                      )
                    ],
                  ),
                ),
              );
            },
          ),
        ),
        _CartCheckoutBar(
          total: cart.totalAmount,
          isCheckingOut: _isCheckingOut,
          onCheckout: () => _handleCheckout(context, cart),
        ),
        SizedBox(height: BulkaLayout.floatingNavBarHeight),
      ],
    );
  }
}

class _CartCheckoutBar extends StatelessWidget {
  const _CartCheckoutBar({required this.total, required this.isCheckingOut, required this.onCheckout});
  final int total;
  final bool isCheckingOut;
  final VoidCallback onCheckout;
  
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.05), blurRadius: 10, offset: const Offset(0, -5))],
      ),
      child: SafeArea(
        child: Row(
          children: [
            Expanded(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Итого к оплате:', style: TextStyle(fontSize: 14, color: _textDark)),
                  Text('$total ₸', style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: _textDark)),
                ],
              ),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: GradientButton(
                onPressed: isCheckingOut ? () {} : onCheckout,
                child: isCheckingOut
                    ? const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                    : const Text('Оформить', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class BalanceHistoryScreen extends StatelessWidget {
  const BalanceHistoryScreen({
    required this.transactions,
    this.onExplore,
    super.key,
  });

  final List<BonusTransaction> transactions;
  final VoidCallback? onExplore;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(
          'balance_history_title'.tr,
          style: const TextStyle(
            fontFamily: _headingFont,
            fontWeight: FontWeight.w400,
          ),
        ),
      ),
      body: transactions.isEmpty
          ? Center(
              child: Container(
                margin: const EdgeInsets.all(24),
                padding: const EdgeInsets.all(24),
                decoration: BoxDecoration(
                  color: _cream,
                  borderRadius: BorderRadius.circular(24),
                  boxShadow: _softShadow,
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(
                      Icons.receipt_long_rounded,
                      color: _caramel,
                      size: 38,
                    ),
                    const SizedBox(height: 12),
                    Text(
                      'orders_empty_title'.tr,
                      style: const TextStyle(
                        color: _textDark,
                        fontFamily: _headingFont,
                        fontSize: 18,
                        fontWeight: FontWeight.w400,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'orders_empty_sub'.tr,
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: _textDark.withValues(alpha: 0.58),
                        fontSize: 14,
                      ),
                    ),
                    if (onExplore != null) ...[
                      const SizedBox(height: 18),
                      SizedBox(
                        width: double.infinity,
                        child: GradientButton(
                          onPressed: onExplore,
                          child: Text('orders_empty_action'.tr),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            )
          : ListView.separated(
              padding: EdgeInsets.fromLTRB(
                16,
                8,
                16,
                BulkaLayout.bottomNavContentInset(context),
              ),
              itemBuilder: (_, index) =>
                  TransactionCard(transaction: transactions[index]),
              separatorBuilder: (_, _) => const SizedBox(height: 12),
              itemCount: transactions.length,
            ),
    );
  }
}

class TransactionCard extends StatelessWidget {
  const TransactionCard({required this.transaction, super.key});

  final BonusTransaction transaction;

  void _showReceiptDetails(BuildContext context) {
    if (transaction.items == null || transaction.items!.isEmpty) return;

    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (context) {
        return Container(
          decoration: const BoxDecoration(
            color: _cream,
            borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
          ),
          padding: const EdgeInsets.all(24),
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
                    borderRadius: BorderRadius.circular(2),
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
                        fontSize: 20,
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
                    final name = _asString(
                      item['name'],
                      fallback: 'product_fallback'.tr,
                    );
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
                                fontSize: 16,
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Text(
                            '${formatMoney(double.tryParse(price.toString()) ?? 0)} ₸',
                            style: const TextStyle(
                              color: _textDark,
                              fontSize: 16,
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
    final color = earning ? _successGreen : _errorRed;
    final prefix = earning ? '+' : '-';
    final hasItems = transaction.items != null && transaction.items!.isNotEmpty;

    return Card(
      color: _cream,
      elevation: 0,
      shadowColor: Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(20),
        side: BorderSide(color: _almond.withValues(alpha: 0.45)),
      ),
      child: InkWell(
        onTap: hasItems ? () => _showReceiptDetails(context) : null,
        borderRadius: BorderRadius.circular(20),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Container(
                          width: 34,
                          height: 34,
                          decoration: BoxDecoration(
                            color: color.withValues(alpha: 0.12),
                            shape: BoxShape.circle,
                          ),
                          child: Icon(
                            earning
                                ? Icons.keyboard_arrow_up_rounded
                                : Icons.keyboard_arrow_down_rounded,
                            color: color,
                            size: 22,
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            localizeTransactionType(
                              transaction.type,
                              isEarning: transaction.isEarning,
                            ),
                            style: const TextStyle(
                              color: _textDark,
                              fontFamily: _headingFont,
                              fontSize: 16,
                              fontWeight: FontWeight.w400,
                            ),
                          ),
                        ),
                        Text(
                          '$prefix${formatMoney(transaction.amount)} ₸',
                          style: TextStyle(
                            color: color,
                            fontSize: 16,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ],
                    ),
                    if ((transaction.orderTotal ?? 0) > 0) ...[
                      const SizedBox(height: 8),
                      Text(
                        '${'check_sum'.tr}: ${formatMoney(transaction.orderTotal!)} ₸',
                        style: TextStyle(
                          color: _textDark.withValues(alpha: 0.7),
                          fontSize: 14,
                        ),
                      ),
                    ],
                    const SizedBox(height: 4),
                    Text(
                      formatDateTime(transaction.timestamp),
                      style: TextStyle(
                        color: _textDark.withValues(alpha: 0.5),
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ),
              if (hasItems) ...[
                const SizedBox(width: 8),
                Icon(
                  Icons.chevron_right_rounded,
                  color: _textDark.withValues(alpha: 0.3),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
