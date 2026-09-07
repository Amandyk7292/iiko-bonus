part of '../main.dart';

class LoyaltyTierCard extends StatelessWidget {
  const LoyaltyTierCard({
    this.tier,
    this.cashbackPercent = 0,
    this.totalSpent = 0,
    this.vipThreshold = 0,
    super.key,
  });
  final Tier? tier;
  final int cashbackPercent;
  final double totalSpent;
  final double vipThreshold;

  @override
  Widget build(BuildContext context) {
    final current = tier;
    final name = current?.localizedName ?? 'tier_base'.tr;
    final percent = current?.percent ?? cashbackPercent;
    final tiers = current?.allTiers ?? const <TierItem>[];
    final level = max(current?.level ?? 1, 1);
    final total = max(tiers.length, level);
    final next = current?.localizedNextTier;
    var nextPercent = current?.nextPercent ?? percent;
    if (next != null && current != null && current.nextPercent == null) {
      for (final item in tiers) {
        if (item.name == current.nextTier || item.localizedName == next) {
          nextPercent = item.percent;
          break;
        }
      }
      if (nextPercent == percent && level < tiers.length) {
        nextPercent = tiers[level].percent;
      }
    }
    final progress =
        current?.progressFraction ??
        (vipThreshold > 0 ? (totalSpent / vipThreshold).clamp(0.0, 1.0) : 0.0);
    final description = current == null
        ? 'tier_current'.trArgs({'percent': percent})
        : next == null
        ? 'tier_max'.trArgs({'name': name, 'percent': percent})
        : 'tier_next'.trArgs({
            'name': next,
            'percent': nextPercent,
            'remaining': formatGroupedNumber(current.remaining),
          });
    final code = ['silver', 'platinum'].contains(current?.code)
        ? current!.code
        : 'bronze';
    final path = current?.backgroundImageUrl ?? '/assets/loyalty/$code-v1.webp';
    final imageUrl = Uri.parse(_apiBaseUrl).resolve(path).toString();

    return ClipRRect(
      borderRadius: BorderRadius.circular(BulkaRadii.card),
      child: Stack(
        children: [
          const Positioned.fill(child: ColoredBox(color: Color(0xFF241A15))),
          Positioned.fill(
            child: ExcludeSemantics(
              child: _NetworkImage(
                url: imageUrl,
                fit: BoxFit.cover,
                loadingPlaceholder: const SizedBox.shrink(),
                errorPlaceholder: const SizedBox.shrink(),
              ),
            ),
          ),
          const Positioned.fill(child: ColoredBox(color: Color(0x731F140F))),
          const Positioned.fill(
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [Color(0x33000000), Colors.transparent],
                ),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Icon(
                      Icons.workspace_premium_rounded,
                      color: Color(0xFFFFD790),
                      size: 26,
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        'tier_status'.trArgs({
                          'name': name,
                          'percent': percent,
                        }),
                        style: const TextStyle(
                          color: Colors.white,
                          fontFamily: _headingFont,
                          fontSize: BulkaTypeScale.titleSmall,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                Text(
                  'tier_level'.trArgs({'level': level, 'total': total}),
                  style: const TextStyle(
                    color: Color(0xFFFFD790),
                    fontSize: BulkaTypeScale.caption,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 24),
                Text(
                  description,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: BulkaTypeScale.bodySmall,
                    height: 1.45,
                  ),
                ),
                const SizedBox(height: 18),
                ClipRRect(
                  borderRadius: BorderRadius.circular(BulkaRadii.pill),
                  child: LinearProgressIndicator(
                    value: progress,
                    minHeight: 6,
                    backgroundColor: const Color(0x40FFFFFF),
                    valueColor: const AlwaysStoppedAnimation(Color(0xFFFFD790)),
                  ),
                ),
                if (tiers.isNotEmpty) ...[
                  const SizedBox(height: 16),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (var index = 0; index < tiers.length; index++)
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 6,
                          ),
                          decoration: BoxDecoration(
                            color: const Color(0x66000000),
                            borderRadius: BorderRadius.circular(
                              BulkaRadii.pill,
                            ),
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(
                                index < level
                                    ? Icons.check_circle_rounded
                                    : Icons.radio_button_unchecked,
                                size: 14,
                                color: index < level
                                    ? const Color(0xFFFFD790)
                                    : Colors.white,
                              ),
                              const SizedBox(width: 5),
                              Flexible(
                                child: Text(
                                  '${tiers[index].localizedName} ${tiers[index].percent}%',
                                  style: const TextStyle(
                                    color: Colors.white,
                                    fontSize: BulkaTypeScale.caption,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                    ],
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}
