part of '../main.dart';

class LoyaltyTierCard extends StatefulWidget {
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

  @override
  State<LoyaltyTierCard> createState() => _LoyaltyTierCardState();
}

class _LoyaltyTierCardState extends State<LoyaltyTierCard>
    with SingleTickerProviderStateMixin {
  late final AnimationController _motionController;
  bool _motionEnabled = false;

  @override
  void initState() {
    super.initState();
    _motionController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 4800),
    );
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final enabled =
        !MediaQuery.disableAnimationsOf(context) && TickerMode.of(context);
    if (enabled == _motionEnabled) return;
    _motionEnabled = enabled;
    if (enabled) {
      _motionController.repeat();
    } else {
      _motionController
        ..stop()
        ..value = 0;
    }
  }

  @override
  void dispose() {
    _motionController.dispose();
    super.dispose();
  }

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
    final current = widget.tier;
    final name = current?.localizedName ?? 'tier_base'.tr;
    final percent = current?.percent ?? widget.cashbackPercent;

    return Semantics(
      container: true,
      label:
          '$name, $percent%. ${'loyalty_bonus_balance'.tr}: ${_amount(widget.bonusBalance)}',
      child: AnimatedBuilder(
        animation: _motionController,
        child: _card(name, percent),
        builder: (context, child) {
          final phase = _motionController.value * pi * 2;
          final horizontal = sin(phase);
          final vertical = cos(phase);
          final matrix = Matrix4.identity()
            ..setEntry(3, 2, 0.0018)
            ..rotateX(vertical * 0.046)
            ..rotateY(horizontal * 0.11);
          return Transform(
            alignment: Alignment.center,
            transform: matrix,
            child: DecoratedBox(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(BulkaRadii.card),
                boxShadow: [
                  BoxShadow(
                    color: const Color(0xFF703111).withValues(alpha: 0.16),
                    blurRadius: 18 + (vertical + 1) * 3,
                    spreadRadius: 0.5,
                    offset: Offset(-horizontal * 9, 8 + vertical * 3),
                  ),
                ],
              ),
              child: child,
            ),
          );
        },
      ),
    );
  }

  Widget _card(String name, int percent) {
    const foreground = Color(0xFF703111);
    return ClipRRect(
      key: const ValueKey('loyalty-tier-card'),
      borderRadius: BorderRadius.circular(BulkaRadii.card),
      child: DecoratedBox(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [Color(0xFFFFC21A), Color(0xFFFFA900)],
          ),
        ),
        child: Stack(
          children: [
            Positioned.fill(
              child: _LoyaltyCardGlare(animation: _motionController),
            ),
            Positioned.fill(
              child: Align(
                alignment: Alignment.center,
                child: IgnorePointer(
                  child: Opacity(
                    opacity: 0.2,
                    child: const _LoyaltyCardLogo(
                      key: ValueKey('loyalty-card-logo'),
                    ),
                  ),
                ),
              ),
            ),
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
                          value: '${_amount(widget.bonusBalance)} Б',
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
                      onTap: widget.onPersonalAccountTap,
                      borderRadius: BorderRadius.circular(BulkaRadii.control),
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(14, 10, 10, 10),
                        child: Row(
                          children: [
                            Expanded(
                              child: Text(
                                '${'loyalty_personal_account'.tr}: ${_amount(widget.personalAccountBalance)} ₸',
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  color: foreground,
                                  fontFamily: _descriptionFont,
                                  fontSize: BulkaTypeScale.bodySmall,
                                  fontWeight: FontWeight.w700,
                                  fontFeatures: [FontFeature.tabularFigures()],
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
    );
  }
}

class _LoyaltyCardLogo extends StatelessWidget {
  const _LoyaltyCardLogo({super.key});

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 74,
          height: 7,
          decoration: BoxDecoration(
            border: Border.all(color: const Color(0xFF703111), width: 2),
            borderRadius: const BorderRadius.all(Radius.elliptical(74, 7)),
          ),
        ),
        const SizedBox(height: 3),
        const Text(
          'Bulka',
          style: TextStyle(
            color: Color(0xFF703111),
            fontFamily: _headingFont,
            fontSize: 38,
            fontWeight: FontWeight.w800,
            height: 0.95,
          ),
        ),
      ],
    );
  }
}

class _LoyaltyCardGlare extends StatelessWidget {
  const _LoyaltyCardGlare({required this.animation});

  final Animation<double> animation;

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: AnimatedBuilder(
        animation: animation,
        builder: (context, child) {
          if (animation.value > 0.3) return const SizedBox.shrink();
          final sweep = Curves.easeInOutCubic.transform(
            (animation.value / 0.3).clamp(0.0, 1.0),
          );
          return LayoutBuilder(
            builder: (context, constraints) => Transform.translate(
              offset: Offset((-0.42 + sweep * 1.45) * constraints.maxWidth, 0),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Transform.rotate(
                  angle: -0.28,
                  child: Opacity(
                    opacity: sin(sweep * pi) * 0.26,
                    child: Container(
                      width: constraints.maxWidth * 0.18,
                      height: constraints.maxHeight * 1.5,
                      decoration: const BoxDecoration(
                        gradient: LinearGradient(
                          colors: [
                            Colors.transparent,
                            Color(0xCCFFFFFF),
                            Colors.transparent,
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          );
        },
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
