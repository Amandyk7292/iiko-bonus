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
  void _showSuccessDialog(BuildContext context) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(
          'success'.tr,
          style: const TextStyle(fontFamily: _headingFont),
        ),
        content: Text(
          'Ваш заказ успешно оформлен!',
          style: const TextStyle(fontSize: 16),
        ),
        actions: [
          TextButton(
            onPressed: () {
              Navigator.pop(context);
              if (widget.onExplore != null) widget.onExplore!();
            },
            child: const Text(
              'OK',
              style: TextStyle(
                color: _bulkaYellow,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _createOrder(CartProvider cart) async {
    if (cart.items.isEmpty) return;
    final items = cart.items.values
        .map(
          (item) => {
            'id': item.id,
            'name': item.name,
            'price': item.price,
            'quantity': item.quantity,
          },
        )
        .toList();
    final total = cart.totalAmount;
    await widget.api.createKaspiPayment(
      phone: widget.customer.phone,
      amount: total.toDouble(),
      cartItems: items,
    );
    cart.clear();
  }

  Future<void> _openCheckout(BuildContext context, CartProvider cart) async {
    if (cart.items.isEmpty) return;
    final completed = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => _CheckoutScreen(
          customer: widget.customer,
          total: cart.totalAmount,
          onSubmit: () => _createOrder(cart),
        ),
      ),
    );
    if (!context.mounted || completed != true) return;
    _showSuccessDialog(context);
  }

  Future<void> _confirmClear(BuildContext context, CartProvider cart) async {
    final shouldClear = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Очистить корзину?'),
        content: const Text('Все добавленные товары будут удалены.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Отмена'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            style: TextButton.styleFrom(foregroundColor: _errorRed),
            child: const Text('Очистить'),
          ),
        ],
      ),
    );
    if (shouldClear == true) cart.clear();
  }

  @override
  Widget build(BuildContext context) {
    final cart = context.watch<CartProvider>();
    final colors = context.bulkaColors;

    return Scaffold(
      backgroundColor: colors.surfaceCream,
      appBar: AppBar(
        automaticallyImplyLeading: false,
        centerTitle: true,
        backgroundColor: Colors.white,
        title: Text(
          'nav_cart'.tr,
          style: const TextStyle(
            fontFamily: _headingFont,
            fontSize: 27,
            fontWeight: FontWeight.w400,
          ),
        ),
        actions: [
          if (cart.items.isNotEmpty)
            IconButton(
              onPressed: () => _confirmClear(context, cart),
              tooltip: 'Очистить корзину',
              icon: const Icon(Icons.delete_outline_rounded),
            ),
          const SizedBox(width: 8),
        ],
      ),
      body: cart.items.isEmpty
          ? _buildEmptyState(context)
          : _buildCartItems(context, cart),
    );
  }

  Widget _buildEmptyState(BuildContext context) {
    return Center(
      child: SingleChildScrollView(
        padding: EdgeInsets.fromLTRB(
          24,
          24,
          24,
          BulkaLayout.bottomNavContentInset(context),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 132,
              height: 132,
              decoration: BoxDecoration(
                color: _lightCardHighlight,
                shape: BoxShape.circle,
                border: Border.all(color: _almond),
              ),
              child: const Icon(
                Icons.shopping_bag_outlined,
                size: 58,
                color: _textDark,
              ),
            ),
            const SizedBox(height: 24),
            Text(
              'cart_empty_title'.tr,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: _textDark,
                fontFamily: _headingFont,
                fontSize: 30,
                fontWeight: FontWeight.w400,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'cart_empty_sub'.tr,
              textAlign: TextAlign.center,
              style: TextStyle(
                color: _textDark.withValues(alpha: 0.66),
                fontSize: 17,
                height: 1.35,
              ),
            ),
            const SizedBox(height: 28),
            SizedBox(
              width: 240,
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
                    fontWeight: FontWeight.w700,
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
    final items = cart.items.values.toList();

    return Column(
      children: [
        Expanded(
          child: ListView.separated(
            padding: const EdgeInsets.fromLTRB(16, 18, 16, 24),
            itemCount: items.length,
            separatorBuilder: (_, _) => const SizedBox(height: 14),
            itemBuilder: (context, index) {
              final item = items[index];
              return _CartProductCard(
                item: item,
                onDecrease: () => cart.setQuantity(item.id, item.quantity - 1),
                onIncrease: () => cart.setQuantity(item.id, item.quantity + 1),
              );
            },
          ),
        ),
        Padding(
          padding: EdgeInsets.only(
            bottom: BulkaLayout.bottomNavigationExtent(context),
          ),
          child: _CartCheckoutBar(
            total: cart.totalAmount,
            onCheckout: () => _openCheckout(context, cart),
          ),
        ),
      ],
    );
  }
}

String _formatCartMoney(int value) {
  final source = value.toString();
  final result = StringBuffer();
  for (var i = 0; i < source.length; i++) {
    if (i > 0 && (source.length - i) % 3 == 0) result.write(' ');
    result.write(source[i]);
  }
  return result.toString();
}

class _CartProductCard extends StatelessWidget {
  const _CartProductCard({
    required this.item,
    required this.onDecrease,
    required this.onIncrease,
  });

  final CartItem item;
  final VoidCallback onDecrease;
  final VoidCallback onIncrease;

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    return Container(
      height: 138,
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: colors.cardBorder),
      ),
      child: Row(
        children: [
          SizedBox(
            width: 126,
            height: double.infinity,
            child: _NetworkImage(url: item.imageUrl, fit: BoxFit.cover),
          ),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(14, 12, 10, 10),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    item.name,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: _textDark,
                      fontSize: 16,
                      height: 1.15,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 5),
                  Text(
                    'В корзине · ${item.quantity} шт',
                    style: TextStyle(
                      color: colors.success,
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const Spacer(),
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          '${_formatCartMoney(item.total)} ₸',
                          maxLines: 1,
                          style: const TextStyle(
                            color: _textDark,
                            fontSize: 16,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ),
                      _CartQuantityStepper(
                        quantity: item.quantity,
                        onDecrease: onDecrease,
                        onIncrease: onIncrease,
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _CartQuantityStepper extends StatelessWidget {
  const _CartQuantityStepper({
    required this.quantity,
    required this.onDecrease,
    required this.onIncrease,
  });

  final int quantity;
  final VoidCallback onDecrease;
  final VoidCallback onIncrease;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 46,
      decoration: BoxDecoration(
        color: _bulkaYellow,
        borderRadius: BorderRadius.circular(15),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          IconButton(
            onPressed: onDecrease,
            tooltip: 'Уменьшить количество',
            constraints: const BoxConstraints.tightFor(width: 44, height: 46),
            padding: EdgeInsets.zero,
            icon: const Icon(Icons.remove_rounded, size: 20),
          ),
          Semantics(
            label: 'Количество',
            value: '$quantity',
            child: SizedBox(
              width: 28,
              child: Text(
                '$quantity',
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: _textDark,
                  fontSize: 16,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
          ),
          IconButton(
            onPressed: onIncrease,
            tooltip: 'Увеличить количество',
            constraints: const BoxConstraints.tightFor(width: 44, height: 46),
            padding: EdgeInsets.zero,
            icon: const Icon(Icons.add_rounded, size: 20),
          ),
        ],
      ),
    );
  }
}

class _CartCheckoutBar extends StatelessWidget {
  const _CartCheckoutBar({required this.total, required this.onCheckout});

  final int total;
  final VoidCallback onCheckout;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(24, 18, 24, 20),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border(top: BorderSide(color: _almond.withValues(alpha: 0.45))),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              const Expanded(
                child: Text(
                  'Вернём бонусами',
                  maxLines: 1,
                  style: TextStyle(fontSize: 15),
                ),
              ),
              const SizedBox(width: 12),
              Text(
                '+ 0 баллов',
                style: TextStyle(
                  color: _textDark.withValues(alpha: 0.72),
                  fontSize: 15,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              const Expanded(
                child: Text(
                  'Итоговая цена:',
                  maxLines: 1,
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
                ),
              ),
              const SizedBox(width: 12),
              Text(
                '${_formatCartMoney(total)} ₸',
                style: const TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            child: GradientButton(
              onPressed: onCheckout,
              child: const Text(
                'Оформить заказ',
                style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _CheckoutScreen extends StatefulWidget {
  const _CheckoutScreen({
    required this.customer,
    required this.total,
    required this.onSubmit,
  });

  final Customer customer;
  final int total;
  final Future<void> Function() onSubmit;

  @override
  State<_CheckoutScreen> createState() => _CheckoutScreenState();
}

class _CheckoutScreenState extends State<_CheckoutScreen> {
  static const _timeSlots = [
    '10:00 – 11:00',
    '11:00 – 12:00',
    '12:00 – 13:00',
    '13:00 – 14:00',
    '14:00 – 15:00',
    '15:00 – 16:00',
    '16:00 – 17:00',
    '17:00 – 18:00',
    '18:00 – 19:00',
  ];

  late final TextEditingController _phoneController;
  final _promoController = TextEditingController();
  final _commentController = TextEditingController();
  String _branch = 'Аскарова, 21';
  String? _pickupTime;
  bool _isSubmitting = false;

  @override
  void initState() {
    super.initState();
    _phoneController = TextEditingController(text: widget.customer.phone);
    _promoController.addListener(_refreshPromoButton);
    unawaited(_loadBranch());
  }

  Future<void> _loadBranch() async {
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getString('selected_bakery_location');
    if (!mounted || saved == null || saved.trim().isEmpty) return;
    setState(() => _branch = saved);
  }

  void _refreshPromoButton() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _promoController.removeListener(_refreshPromoButton);
    _phoneController.dispose();
    _promoController.dispose();
    _commentController.dispose();
    super.dispose();
  }

  Future<void> _selectBranch() async {
    final selected = await Navigator.of(
      context,
    ).push<String>(MaterialPageRoute(builder: (_) => const LocationsScreen()));
    if (!mounted || selected == null || selected.trim().isEmpty) return;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('selected_bakery_location', selected);
    if (mounted) setState(() => _branch = selected);
  }

  Future<void> _selectPickupTime() async {
    final selected = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (sheetContext) => Container(
        height: min(MediaQuery.sizeOf(sheetContext).height * 0.72, 620),
        padding: EdgeInsets.fromLTRB(
          16,
          12,
          16,
          20 + BulkaLayout.safeBottomInset(sheetContext),
        ),
        decoration: const BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.vertical(top: Radius.circular(30)),
        ),
        child: Column(
          children: [
            Container(
              width: 44,
              height: 5,
              decoration: BoxDecoration(
                color: _almond,
                borderRadius: BorderRadius.circular(3),
              ),
            ),
            const SizedBox(height: 18),
            const Text(
              'Выберите время',
              style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 18),
            Expanded(
              child: ListView.separated(
                itemCount: _timeSlots.length,
                separatorBuilder: (_, _) => const SizedBox(height: 8),
                itemBuilder: (context, index) {
                  final slot = _timeSlots[index];
                  final isSelected = slot == _pickupTime;
                  return ListTile(
                    onTap: () => Navigator.pop(sheetContext, slot),
                    selected: isSelected,
                    selectedTileColor: _lightCardHighlight,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(16),
                    ),
                    title: Text(
                      slot,
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: isSelected
                            ? _textDark
                            : _textDark.withValues(alpha: 0.72),
                        fontSize: 18,
                        fontWeight: isSelected
                            ? FontWeight.w800
                            : FontWeight.w500,
                      ),
                    ),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
    if (mounted && selected != null) setState(() => _pickupTime = selected);
  }

  void _applyPromo() {
    FocusScope.of(context).unfocus();
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Проверка промокода пока недоступна.')),
    );
  }

  Future<void> _submit() async {
    if (_pickupTime == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Выберите время самовывоза.')),
      );
      return;
    }
    if (_isSubmitting) return;
    setState(() => _isSubmitting = true);
    try {
      await widget.onSubmit();
      if (mounted) Navigator.pop(context, true);
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(error.toString())));
      setState(() => _isSubmitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    return Scaffold(
      backgroundColor: colors.surfaceCream,
      appBar: AppBar(
        centerTitle: true,
        backgroundColor: Colors.white,
        title: const Text(
          'Оформление заказа',
          style: TextStyle(fontWeight: FontWeight.w700),
        ),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(24, 24, 24, 220),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: double.infinity,
              height: 58,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(29),
                border: Border.all(color: _bulkaYellow, width: 1.5),
              ),
              child: const Text(
                'Самовывоз',
                style: TextStyle(
                  color: _textDark,
                  fontSize: 17,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            const SizedBox(height: 28),
            const _CheckoutLabel('Филиал'),
            const SizedBox(height: 10),
            _CheckoutField(
              label: _branch,
              icon: Icons.storefront_outlined,
              onTap: _selectBranch,
            ),
            const SizedBox(height: 24),
            const _CheckoutLabel('Дополнительный номер'),
            const SizedBox(height: 10),
            TextField(
              controller: _phoneController,
              keyboardType: TextInputType.phone,
              autofillHints: const [AutofillHints.telephoneNumber],
              decoration: const InputDecoration(
                hintText: '+7 700 000 00 00',
                suffixIcon: Icon(Icons.phone_outlined),
              ),
            ),
            const SizedBox(height: 24),
            const _CheckoutLabel('Промокод'),
            const SizedBox(height: 10),
            SizedBox(
              height: 58,
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Expanded(
                    child: TextField(
                      controller: _promoController,
                      textCapitalization: TextCapitalization.characters,
                      decoration: const InputDecoration(
                        hintText: 'Введите код',
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  SizedBox(
                    width: 116,
                    child: FilledButton(
                      onPressed: _promoController.text.trim().isEmpty
                          ? null
                          : _applyPromo,
                      style: FilledButton.styleFrom(
                        backgroundColor: _bulkaYellow,
                        foregroundColor: _textDark,
                        disabledBackgroundColor: _almond.withValues(alpha: 0.5),
                      ),
                      child: const Text('Применить'),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 26),
            const _CheckoutLabel('Выберите время самовывоза', required: true),
            const SizedBox(height: 10),
            _CheckoutField(
              label: _pickupTime ?? 'Выберите время',
              icon: Icons.schedule_rounded,
              onTap: _selectPickupTime,
            ),
            const SizedBox(height: 28),
            const _CheckoutLabel('Выберите способ оплаты', required: true),
            const SizedBox(height: 12),
            Container(
              width: 152,
              height: 94,
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(20),
                border: Border.all(color: _bulkaYellow, width: 1.5),
              ),
              child: const Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Icon(Icons.credit_card_rounded, color: _textDark),
                  Text('Kaspi', style: TextStyle(fontWeight: FontWeight.w700)),
                ],
              ),
            ),
            const SizedBox(height: 28),
            const _CheckoutLabel('Комментарий'),
            const SizedBox(height: 10),
            TextField(
              controller: _commentController,
              minLines: 4,
              maxLines: 6,
              decoration: const InputDecoration(
                hintText: 'Оставьте свой комментарий',
                alignLabelWithHint: true,
              ),
            ),
          ],
        ),
      ),
      bottomNavigationBar: Container(
        padding: EdgeInsets.fromLTRB(
          24,
          16,
          24,
          16 + BulkaLayout.safeBottomInset(context),
        ),
        decoration: BoxDecoration(
          color: Colors.white,
          border: Border(
            top: BorderSide(color: _almond.withValues(alpha: 0.45)),
          ),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            _CheckoutTotalRow(
              label: 'Сумма заказа',
              value: '${_formatCartMoney(widget.total)} ₸',
            ),
            const SizedBox(height: 8),
            _CheckoutTotalRow(
              label: 'Итоговая цена',
              value: '${_formatCartMoney(widget.total)} ₸',
              emphasized: true,
            ),
            const SizedBox(height: 14),
            SizedBox(
              width: double.infinity,
              child: GradientButton(
                onPressed: _isSubmitting ? () {} : _submit,
                child: _isSubmitting
                    ? const SizedBox(
                        width: 24,
                        height: 24,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : const Text(
                        'Оформить заказ',
                        style: TextStyle(
                          fontSize: 17,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _CheckoutLabel extends StatelessWidget {
  const _CheckoutLabel(this.text, {this.required = false});

  final String text;
  final bool required;

  @override
  Widget build(BuildContext context) {
    return Text.rich(
      TextSpan(
        text: text,
        children: [
          if (required)
            const TextSpan(
              text: '*',
              style: TextStyle(color: _errorRed),
            ),
        ],
      ),
      style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
    );
  }
}

class _CheckoutField extends StatelessWidget {
  const _CheckoutField({
    required this.label,
    required this.icon,
    required this.onTap,
  });

  final String label;
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(18),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(18),
        child: Ink(
          height: 62,
          padding: const EdgeInsets.symmetric(horizontal: 18),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: context.bulkaColors.cardBorder),
          ),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 16),
                ),
              ),
              const SizedBox(width: 12),
              Icon(icon, color: _textDark.withValues(alpha: 0.72)),
            ],
          ),
        ),
      ),
    );
  }
}

class _CheckoutTotalRow extends StatelessWidget {
  const _CheckoutTotalRow({
    required this.label,
    required this.value,
    this.emphasized = false,
  });

  final String label;
  final String value;
  final bool emphasized;

  @override
  Widget build(BuildContext context) {
    final style = TextStyle(
      fontSize: emphasized ? 18 : 16,
      fontWeight: emphasized ? FontWeight.w900 : FontWeight.w500,
    );
    return Row(
      children: [
        Expanded(child: Text(label, maxLines: 1, style: style)),
        const SizedBox(width: 12),
        Text(value, maxLines: 1, style: style),
      ],
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
