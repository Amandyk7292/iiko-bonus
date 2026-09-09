part of '../main.dart';

class _CheckoutCardPicker extends StatelessWidget {
  const _CheckoutCardPicker({required this.methods, required this.selectedId});

  final List<Map<String, dynamic>> methods;
  final String? selectedId;

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    return Padding(
      padding: EdgeInsets.only(bottom: BulkaLayout.safeBottomInset(context)),
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.sizeOf(context).height * 0.8,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 14, 12, 12),
              child: Row(
                children: [
                  const SizedBox(width: 40),
                  Expanded(
                    child: Text(
                      'checkout_choose_card'.tr,
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        fontFamily: _headingFont,
                        fontSize: 21,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  IconButton(
                    key: const ValueKey('checkout-close-card-picker'),
                    tooltip: MaterialLocalizations.of(
                      context,
                    ).closeButtonTooltip,
                    onPressed: () => Navigator.of(context).pop(),
                    icon: const Icon(Icons.close_rounded),
                  ),
                ],
              ),
            ),
            Divider(height: 1, color: colors.cardBorder),
            Flexible(
              child: ListView(
                shrinkWrap: true,
                padding: const EdgeInsets.symmetric(vertical: 12),
                children: [
                  for (final method in methods)
                    Semantics(
                      selected: method['id'] == selectedId,
                      child: InkWell(
                        key: ValueKey('checkout-saved-card-${method['id']}'),
                        onTap: () =>
                            Navigator.of(context).pop(method['id'].toString()),
                        child: Padding(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 22,
                            vertical: 12,
                          ),
                          child: _CheckoutCardIdentity(
                            method: method,
                            trailing: Icon(
                              method['id'] == selectedId
                                  ? Icons.check_circle_rounded
                                  : Icons.radio_button_unchecked_rounded,
                              color: method['id'] == selectedId
                                  ? colors.brandBrown
                                  : colors.cardBorder,
                            ),
                          ),
                        ),
                      ),
                    ),
                  if (methods.length < _maximumSavedPaymentMethods)
                    ListTile(
                      key: const ValueKey('checkout-add-saved-card'),
                      contentPadding: const EdgeInsets.symmetric(
                        horizontal: 22,
                        vertical: 8,
                      ),
                      leading: const _CheckoutCardBrand(brand: '', add: true),
                      title: Text('checkout_add_new_card'.tr),
                      onTap: () => Navigator.of(context).pop('add'),
                    )
                  else
                    const Padding(
                      padding: EdgeInsets.all(20),
                      child: _CheckoutSavedCardsLimitNotice(
                        key: ValueKey('checkout-saved-cards-limit'),
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

class _CheckoutCardIdentity extends StatelessWidget {
  const _CheckoutCardIdentity({required this.method, required this.trailing});

  final Map<String, dynamic> method;
  final Widget trailing;

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    final brand = (method['brand'] ?? 'card').toString().toUpperCase();
    final bank = (method['bankName'] ?? '').toString().trim();
    return Row(
      children: [
        _CheckoutCardBrand(brand: brand),
        const SizedBox(width: 14),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Wrap(
                spacing: 8,
                runSpacing: 4,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  Text(
                    bank.isNotEmpty
                        ? bank
                        : brand == 'CARD'
                        ? 'checkout_card_payment'.tr
                        : brand,
                    style: TextStyle(fontSize: 13, color: colors.mutedText),
                  ),
                  if (method['isDefault'] == true)
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 7,
                        vertical: 3,
                      ),
                      decoration: BoxDecoration(
                        color: const Color(0xffe6f4ec),
                        borderRadius: BorderRadius.circular(5),
                      ),
                      child: Text(
                        'payment_methods_default'.tr,
                        style: const TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          color: Color(0xff327158),
                        ),
                      ),
                    ),
                ],
              ),
              const SizedBox(height: 5),
              Text(
                '•••• ${method['lastFour'] ?? ''}',
                style: const TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0.5,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(width: 8),
        trailing,
      ],
    );
  }
}

class _CheckoutCardBrand extends StatelessWidget {
  const _CheckoutCardBrand({required this.brand, this.add = false});

  final String brand;
  final bool add;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 54,
      height: 50,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: context.bulkaColors.cardBorder),
        borderRadius: BorderRadius.circular(11),
      ),
      child: add
          ? const Icon(Icons.add_rounded, size: 28)
          : brand == 'VISA'
          ? const Text(
              'VISA',
              style: TextStyle(
                fontFamily: _headingFont,
                fontSize: 17,
                fontWeight: FontWeight.w900,
                fontStyle: FontStyle.italic,
                color: Color(0xff143879),
              ),
            )
          : brand == 'MASTERCARD'
          ? SizedBox(
              width: 35,
              height: 24,
              child: Stack(
                children: [
                  Positioned(
                    left: 0,
                    top: 1,
                    child: Container(
                      width: 22,
                      height: 22,
                      decoration: const BoxDecoration(
                        color: Color(0xffeb001b),
                        shape: BoxShape.circle,
                      ),
                    ),
                  ),
                  Positioned(
                    right: 0,
                    top: 1,
                    child: Container(
                      width: 22,
                      height: 22,
                      decoration: const BoxDecoration(
                        color: Color(0xddf79e1b),
                        shape: BoxShape.circle,
                      ),
                    ),
                  ),
                ],
              ),
            )
          : const Icon(Icons.credit_card_outlined, size: 27),
    );
  }
}
