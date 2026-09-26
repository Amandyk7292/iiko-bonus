part of '../main.dart';

class LoyaltyTierCard extends StatelessWidget {
  const LoyaltyTierCard({
    this.tier,
    this.cashbackPercent = 0,
    this.bonusBalance = 0,
    this.personalAccountBalance = 0,
    this.onPersonalAccountTap,
    super.key,
  });

  final Tier? tier;
  final int cashbackPercent;
  final double bonusBalance;
  final double personalAccountBalance;
  final VoidCallback? onPersonalAccountTap;

  String _amount(num value) {
    final normalized = value
        .toStringAsFixed(2)
        .replaceFirst(RegExp(r'\.?0+$'), '');
    return normalized.replaceAllMapped(
      RegExp(r'\B(?=(\d{3})+(?!\d))'),
      (_) => ' ',
    );
  }

  @override
  Widget build(BuildContext context) {
    final current = tier;
    final name = current?.localizedName ?? 'tier_base'.tr;
    final percent = current?.percent ?? cashbackPercent;
    const foreground = Color(0xFF703111);

    return Semantics(
      container: true,
      label:
          '$name, $percent%. ${'loyalty_bonus_balance'.tr}: ${_amount(bonusBalance)}',
      child: ClipRRect(
        key: const ValueKey('loyalty-tier-card'),
        borderRadius: BorderRadius.circular(BulkaRadii.card),
        child: DecoratedBox(
          decoration: const BoxDecoration(
            color: Color(0xFFFFB300),
            image: DecorationImage(
              image: AssetImage('assets/brand/loyalty_background.png'),
              fit: BoxFit.cover,
            ),
          ),
          child: Stack(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 18, 20, 16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: _LoyaltyMetric(
                            value: '$name $percent%',
                            label: 'loyalty_cashback_level'.tr,
                            crossAxisAlignment: CrossAxisAlignment.start,
                          ),
                        ),
                        const SizedBox(width: 16),
                        Expanded(
                          child: _LoyaltyMetric(
                            value: '${_amount(bonusBalance)} Б',
                            label:
                                '${'loyalty_bonus_balance'.tr}\n${'loyalty_bonus_rate'.tr}',
                            crossAxisAlignment: CrossAxisAlignment.end,
                            textAlign: TextAlign.end,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 52),
                    Material(
                      color: Colors.white.withValues(alpha: 0.38),
                      borderRadius: BorderRadius.circular(BulkaRadii.control),
                      child: InkWell(
                        key: const ValueKey('loyalty-personal-account'),
                        onTap: onPersonalAccountTap,
                        borderRadius: BorderRadius.circular(BulkaRadii.control),
                        child: Padding(
                          padding: const EdgeInsets.fromLTRB(14, 10, 10, 10),
                          child: Row(
                            children: [
                              Expanded(
                                child: Text(
                                  '${'loyalty_personal_account'.tr}: ${_amount(personalAccountBalance)} ₸',
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    color: foreground,
                                    fontFamily: _descriptionFont,
                                    fontSize: BulkaTypeScale.bodySmall,
                                    fontWeight: FontWeight.w700,
                                    fontFeatures: [
                                      FontFeature.tabularFigures(),
                                    ],
                                  ),
                                ),
                              ),
                              const SizedBox(width: 8),
                              Container(
                                width: 40,
                                height: 40,
                                decoration: const BoxDecoration(
                                  color: foreground,
                                  shape: BoxShape.circle,
                                ),
                                alignment: Alignment.center,
                                child: const Icon(
                                  Icons.add_rounded,
                                  color: Colors.white,
                                  size: 24,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _LoyaltyMetric extends StatelessWidget {
  const _LoyaltyMetric({
    required this.value,
    required this.label,
    required this.crossAxisAlignment,
    this.textAlign = TextAlign.start,
  });

  final String value;
  final String label;
  final CrossAxisAlignment crossAxisAlignment;
  final TextAlign textAlign;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: crossAxisAlignment,
      children: [
        Text(
          value,
          textAlign: textAlign,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(
            color: Color(0xFF703111),
            fontFamily: _headingFont,
            fontSize: BulkaTypeScale.title,
            fontWeight: FontWeight.w800,
            height: 1.1,
            fontFeatures: [FontFeature.tabularFigures()],
          ),
        ),
        const SizedBox(height: 5),
        Text(
          label,
          textAlign: textAlign,
          style: const TextStyle(
            color: Color(0xFF703111),
            fontSize: BulkaTypeScale.caption,
            fontWeight: FontWeight.w500,
            height: 1.28,
          ),
        ),
      ],
    );
  }
}
