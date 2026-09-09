part of '../main.dart';

@visibleForTesting
Widget buildCheckoutBonusSwitchForTest({
  required bool enabled,
  required int? available,
  required int maximum,
  required bool busy,
  required ValueChanged<bool> onChanged,
}) => _CheckoutBonusSwitch(
  enabled: enabled,
  available: available,
  maximum: maximum,
  busy: busy,
  onChanged: onChanged,
);

class _CheckoutBonusSwitch extends StatelessWidget {
  const _CheckoutBonusSwitch({
    required this.enabled,
    required this.available,
    required this.maximum,
    required this.busy,
    required this.onChanged,
  });

  final bool enabled;
  final int? available;
  final int maximum;
  final bool busy;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: context.bulkaColors.cardBorder),
        borderRadius: BorderRadius.circular(BulkaRadii.control),
      ),
      child: SwitchListTile.adaptive(
        key: const ValueKey('checkout-use-bonuses'),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        value: enabled,
        onChanged: busy || (!enabled && maximum <= 0) ? null : onChanged,
        activeTrackColor: context.bulkaColors.brandGold,
        title: Text(
          'checkout_use_bonuses'.tr,
          style: const TextStyle(
            fontFamily: _headingFont,
            fontWeight: FontWeight.w700,
          ),
        ),
        subtitle: Padding(
          padding: const EdgeInsets.only(top: 6),
          child: Text(
            available == null
                ? 'checkout_bonus_after_quote'.tr
                : '${'checkout_bonus_balance'.trArgs({'amount': _formatCartMoney(available!)})}\n${'checkout_bonus_limit'.tr}',
            style: TextStyle(
              fontSize: 12,
              height: 1.4,
              color: context.bulkaColors.mutedText,
            ),
          ),
        ),
      ),
    );
  }
}

extension _CheckoutBonusControl on _CheckoutScreenState {
  Widget _buildBonusSwitch() => _CheckoutBonusSwitch(
    enabled: _useBonuses,
    available: _bonusAvailable,
    maximum: _bonusMaximum,
    busy: _isQuoting || _isSubmitting,
    onChanged: (value) {
      _updateCheckoutState(() {
        _useBonuses = value;
        _quotedTotal = null;
        _bonusSpent = 0;
      });
      unawaited(_refreshQuote());
    },
  );
}
