part of '../main.dart';

class _LoyaltyPanel extends StatelessWidget {
  const _LoyaltyPanel({
    required this.api,
    required this.customer,
    required this.transactions,
    required this.expanded,
    required this.onToggle,
    required this.onHistoryTap,
    required this.onQrTap,
  });

  final BulkaApiClient api;
  final Customer customer;
  final List<BonusTransaction> transactions;
  final bool expanded;
  final VoidCallback onToggle;
  final VoidCallback onHistoryTap;
  final VoidCallback onQrTap;

  @override
  Widget build(BuildContext context) {
    final purchaseCount = _recentPurchaseCount(transactions);
    final firstReward = _RewardState.fromPurchases(purchaseCount, 6);
    final secondReward = _RewardState.fromPurchases(purchaseCount, 12);
    final tier = customer.tier;
    final standardDuration = BulkaMotion.duration(
      context,
      BulkaMotion.standard,
    );
    final fastDuration = BulkaMotion.duration(context, BulkaMotion.fast);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          clipBehavior: Clip.antiAlias,
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(BulkaRadii.card),
            gradient: const LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [Color(0xFFFFE082), Color(0xFFFFD54F), Color(0xFFFFB300)],
              stops: [0, 0.52, 1],
            ),
          ),
          child: Stack(
            children: [
              Positioned(
                right: -34,
                top: -28,
                child: Container(
                  width: 118,
                  height: 118,
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.2),
                    borderRadius: BorderRadius.circular(BulkaRadii.sheet),
                  ),
                ),
              ),
              Column(
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'show_qr_cashier'.tr,
                              style: const TextStyle(
                                color: Color(0xFF6D3317),
                                fontFamily: _headingFont,
                                fontSize: BulkaTypeScale.title,
                                height: 1.08,
                                fontWeight: FontWeight.w400,
                              ),
                            ),
                            const SizedBox(height: 20),
                            SizedBox(
                              width: 184,
                              height: 54,
                              child: FilledButton(
                                onPressed: onQrTap,
                                style: FilledButton.styleFrom(
                                  backgroundColor: Colors.white,
                                  foregroundColor: const Color(0xFF6D3317),
                                  shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(
                                      BulkaRadii.control,
                                    ),
                                  ),
                                ),
                                child: Text(
                                  'open_qr_btn'.tr,
                                  style: const TextStyle(
                                    color: Color(0xFF6D3317),
                                    fontSize: BulkaTypeScale.titleSmall,
                                    fontWeight: FontWeight.w500,
                                  ),
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: 16),
                      InkWell(
                        key: const ValueKey('qr-preview-button'),
                        onTap: onQrTap,
                        borderRadius: BorderRadius.circular(BulkaRadii.card),
                        child: BulkaHero(
                          tag: 'qr-${customer.phone}',
                          child: _InlineQrPreview(api: api, customer: customer),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 18),
                  Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            TweenAnimationBuilder<double>(
                              tween: Tween<double>(end: customer.balance),
                              duration: standardDuration,
                              curve: BulkaMotion.standardCurve,
                              builder: (context, value, _) => Text(
                                '${'balance_prefix'.tr}${formatMoney(value)}${'points_suffix'.tr}',
                                style: const TextStyle(
                                  color: Color(0xFF6D3317),
                                  fontFamily: _headingFont,
                                  fontSize: BulkaTypeScale.title,
                                  fontWeight: FontWeight.w400,
                                ),
                              ),
                            ),
                            const SizedBox(height: 8),
                            Text(
                              '${'cashback_gift_1'.tr}${tier?.percent ?? customer.cashbackPercent}${'cashback_gift_2'.tr}',
                              style: const TextStyle(
                                color: Color(0xFF6D3317),
                                fontSize: BulkaTypeScale.body,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ],
                        ),
                      ),
                      Semantics(
                        button: true,
                        expanded: expanded,
                        label: expanded
                            ? 'collapse_tooltip'.tr
                            : 'expand_tooltip'.tr,
                        child: IconButton(
                          tooltip: expanded
                              ? 'collapse_tooltip'.tr
                              : 'expand_tooltip'.tr,
                          onPressed: () {
                            BulkaMotion.selection();
                            onToggle();
                          },
                          style: IconButton.styleFrom(
                            minimumSize: const Size(48, 48),
                            tapTargetSize: MaterialTapTargetSize.padded,
                          ),
                          icon: AnimatedRotation(
                            turns: expanded ? 0.5 : 0,
                            duration: fastDuration,
                            child: const Icon(
                              Icons.keyboard_arrow_down_rounded,
                              color: Color(0xFF6D3317),
                              size: 22,
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ],
          ),
        ),
        BulkaExpandable(
          expanded: expanded,
          duration: BulkaMotion.standard,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(0, 22, 0, 0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (tier != null)
                  _TierProgressSection(tier: tier)
                else ...[
                  _RewardProgress(
                    title: 'reward_6_desc'.tr,
                    remaining: firstReward.remaining,
                    progress: firstReward.progress,
                  ),
                  const SizedBox(height: 22),
                  _RewardProgress(
                    title: 'reward_12_desc'.tr,
                    remaining: secondReward.remaining,
                    progress: secondReward.progress,
                  ),
                  const SizedBox(height: 24),
                  _StampRow(completed: purchaseCount, total: 12),
                ],
                const SizedBox(height: 28),
                SizedBox(
                  width: double.infinity,
                  height: 58,
                  child: GradientButton(
                    key: const ValueKey('balance-history-button'),
                    onPressed: onHistoryTap,
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        const Icon(
                          Icons.history,
                          size: 20,
                          color: Colors.white,
                        ),
                        const SizedBox(width: 8),
                        Flexible(
                          child: Text(
                            'balance_history_btn'.tr,
                            maxLines: 2,
                            overflow: TextOverflow.fade,
                            textAlign: TextAlign.center,
                            style: const TextStyle(
                              fontSize: BulkaTypeScale.title,
                              fontWeight: FontWeight.w400,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _TierProgressSection extends StatelessWidget {
  const _TierProgressSection({required this.tier});

  final Tier tier;

  @override
  Widget build(BuildContext context) {
    final tiers = tier.allTiers;
    final currentName = tier.localizedName;
    final nextName = tier.localizedNextTier;
    var nextPercent = tier.nextPercent ?? tier.percent;
    if (nextName != null) {
      for (final item in tiers) {
        if (item.name == tier.nextTier || item.localizedName == nextName) {
          nextPercent = item.percent;
          break;
        }
      }
      if (nextPercent == tier.percent && tier.level < tiers.length) {
        nextPercent = tiers[tier.level].percent;
      }
    }
    final totalLevels = max(tiers.length, tier.level).clamp(1, 999);
    final description = nextName == null
        ? 'tier_max'.trArgs({'name': currentName, 'percent': tier.percent})
        : 'tier_next'.trArgs({
            'name': nextName,
            'percent': nextPercent,
            'remaining': formatGroupedNumber(tier.remaining),
          });
    final progress = tier.progressFraction;

    return Semantics(
      container: true,
      label: description,
      value: '${(progress * 100).round()}%',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Icon(
                Icons.workspace_premium_rounded,
                color: Color(0xFFFFB300),
                size: 26,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  'tier_status'.trArgs({
                    'name': currentName,
                    'percent': tier.percent,
                  }),
                  style: const TextStyle(
                    color: _textDark,
                    fontFamily: _headingFont,
                    fontSize: BulkaTypeScale.titleSmall,
                    fontWeight: FontWeight.w400,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Text(
                'tier_level'.trArgs({
                  'level': tier.level.clamp(1, totalLevels),
                  'total': totalLevels,
                }),
                style: TextStyle(
                  fontFamily: _headingFont,
                  color: _textDark.withValues(alpha: 0.58),
                  fontSize: BulkaTypeScale.caption,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Text(
            description,
            style: TextStyle(
              color: _textDark.withValues(alpha: 0.72),
              fontSize: BulkaTypeScale.bodySmall,
              height: 1.4,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 14),
          ClipRRect(
            borderRadius: BorderRadius.circular(BulkaRadii.pill),
            child: LinearProgressIndicator(
              value: progress,
              minHeight: 10,
              backgroundColor: const Color(0xFFF1F0EE),
              valueColor: const AlwaysStoppedAnimation<Color>(
                Color(0xFFFFB300),
              ),
            ),
          ),
          if (tiers.isNotEmpty) ...[
            const SizedBox(height: 14),
            Wrap(
              spacing: 10,
              runSpacing: 8,
              children: [
                for (var index = 0; index < tiers.length; index++)
                  _TierChip(item: tiers[index], achieved: index < tier.level),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class _TierChip extends StatelessWidget {
  const _TierChip({required this.item, required this.achieved});

  final TierItem item;
  final bool achieved;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(
          achieved ? Icons.check_circle_rounded : Icons.radio_button_unchecked,
          size: 15,
          color: achieved ? const Color(0xFFFF9800) : const Color(0xFFAFA28D),
        ),
        const SizedBox(width: 4),
        Text(
          '${item.localizedName} ${item.percent}%',
          style: TextStyle(
            color: achieved ? _textDark : const Color(0xFFAFA28D),
            fontSize: BulkaTypeScale.caption,
            fontWeight: achieved ? FontWeight.w700 : FontWeight.w600,
          ),
        ),
      ],
    );
  }
}

class _InlineQrPreview extends StatefulWidget {
  const _InlineQrPreview({required this.api, required this.customer});

  final BulkaApiClient api;
  final Customer customer;

  @override
  State<_InlineQrPreview> createState() => _InlineQrPreviewState();
}

class _InlineQrPreviewState extends State<_InlineQrPreview> {
  Timer? _timer;
  int? _loadedWindow;
  String? _token;
  bool _loading = true;
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    _refreshForCurrentWindow();
  }

  @override
  void didUpdateWidget(covariant _InlineQrPreview oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.customer.phone != widget.customer.phone) {
      _loadedWindow = null;
      _refreshForCurrentWindow();
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _refreshForCurrentWindow() async {
    if (!mounted) return;
    final now = DateTime.now().millisecondsSinceEpoch;
    final window = now ~/ 300000;
    if (_loadedWindow == window && _token != null) {
      _scheduleNextWindowRefresh();
      return;
    }
    setState(() => _loading = true);
    try {
      final token = await widget.api.getQrToken(widget.customer.phone);
      if (!mounted) return;
      setState(() {
        _token = token;
        _loadedWindow = window;
        _loading = false;
        _failed = false;
      });
      _scheduleNextWindowRefresh();
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _token = null;
        _loading = false;
        _failed = true;
      });
      _timer?.cancel();
      _timer = Timer(const Duration(seconds: 20), _refreshForCurrentWindow);
    }
  }

  void _scheduleNextWindowRefresh() {
    final now = DateTime.now().millisecondsSinceEpoch;
    final msUntilNextWindow = 300000 - (now % 300000) + 250;
    _timer?.cancel();
    _timer = Timer(
      Duration(milliseconds: msUntilNextWindow),
      _refreshForCurrentWindow,
    );
  }

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: _failed,
      label: _failed ? 'qr_retry'.tr : 'my_qr'.tr,
      child: Container(
        width: 116,
        height: 116,
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(BulkaRadii.card),
        ),
        child: _loading
            ? const Center(
                child: SizedBox(
                  width: 24,
                  height: 24,
                  child: CircularProgressIndicator(
                    color: _bulkaYellow,
                    strokeWidth: 3,
                  ),
                ),
              )
            : _token == null
            ? IconButton(
                onPressed: _refreshForCurrentWindow,
                tooltip: 'qr_retry'.tr,
                icon: const Icon(
                  Icons.refresh_rounded,
                  color: _caramel,
                  size: 42,
                ),
              )
            : Stack(
                alignment: Alignment.center,
                children: [
                  QrImageView(
                    data: _token!,
                    backgroundColor: Colors.white,
                    errorCorrectionLevel: QrErrorCorrectLevel.H,
                    eyeStyle: const QrEyeStyle(
                      eyeShape: QrEyeShape.square,
                      color: Color(0xFF4E2C1E),
                    ),
                    dataModuleStyle: const QrDataModuleStyle(
                      dataModuleShape: QrDataModuleShape.circle,
                      color: Color(0xFF4E2C1E),
                    ),
                  ),
                  Container(
                    width: 22,
                    height: 22,
                    decoration: BoxDecoration(
                      color: Colors.white,
                      shape: BoxShape.circle,
                      border: Border.all(color: Colors.white, width: 2),
                    ),
                    child: ClipOval(
                      child: Image.asset(
                        'assets/brand/qr_logo.png',
                        fit: BoxFit.cover,
                      ),
                    ),
                  ),
                ],
              ),
      ),
    );
  }
}

class _RewardProgress extends StatelessWidget {
  const _RewardProgress({
    required this.title,
    required this.remaining,
    required this.progress,
  });

  final String title;
  final int remaining;
  final double progress;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: const TextStyle(
            color: Colors.black,
            fontFamily: _headingFont,
            fontSize: BulkaTypeScale.titleSmall,
            height: 1.2,
            fontWeight: FontWeight.w400,
          ),
        ),
        const SizedBox(height: 14),
        TweenAnimationBuilder<double>(
          tween: Tween<double>(end: progress.clamp(0, 1)),
          duration: BulkaMotion.duration(context, BulkaMotion.emphasized),
          curve: BulkaMotion.enterCurve,
          builder: (context, animatedProgress, _) => Stack(
            clipBehavior: Clip.none,
            children: [
              Container(
                height: 8,
                decoration: BoxDecoration(
                  color: const Color(0xFFF1F0EE),
                  borderRadius: BorderRadius.circular(BulkaRadii.pill),
                ),
              ),
              FractionallySizedBox(
                widthFactor: animatedProgress,
                child: Container(
                  height: 8,
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(
                      colors: [Color(0xFFFFD54F), Color(0xFFFFB300)],
                    ),
                    borderRadius: BorderRadius.circular(BulkaRadii.pill),
                  ),
                ),
              ),
              Positioned(
                left: 0,
                right: 0,
                top: -12,
                child: Align(
                  alignment: FractionalOffset(animatedProgress, 0.5),
                  child: Container(
                    width: 34,
                    height: 34,
                    decoration: BoxDecoration(
                      color: const Color(0xFFF8D7DD),
                      shape: BoxShape.circle,
                      border: Border.all(color: Colors.white, width: 3),
                    ),
                    child: const Icon(
                      Icons.person_rounded,
                      color: Color(0xFFB86A7B),
                      size: 22,
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 20),
        Text(
          '${'remaining_purchases'.tr}: $remaining',
          style: const TextStyle(
            color: Colors.black,
            fontSize: BulkaTypeScale.title,
            fontWeight: FontWeight.w500,
          ),
        ),
      ],
    );
  }
}

class _StampRow extends StatelessWidget {
  const _StampRow({required this.completed, required this.total});

  final int completed;
  final int total;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        for (var row = 0; row < 2; row++) ...[
          Row(
            children: [
              for (var i = 0; i < 6; i++)
                Expanded(
                  child: Center(
                    child: _StampDot(
                      filled: row * 6 + i < min(completed, total),
                    ),
                  ),
                ),
            ],
          ),
          if (row == 0) const SizedBox(height: 14),
        ],
      ],
    );
  }
}

class _StampDot extends StatelessWidget {
  const _StampDot({required this.filled});

  final bool filled;

  @override
  Widget build(BuildContext context) {
    return AnimatedContainer(
      duration: BulkaMotion.duration(context, BulkaMotion.fast),
      curve: BulkaMotion.standardCurve,
      width: 42,
      height: 42,
      decoration: BoxDecoration(
        color: filled ? null : Colors.white,
        gradient: filled
            ? const LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [Color(0xFFFFD54F), Color(0xFFFFB300)],
              )
            : null,
        shape: BoxShape.circle,
        border: Border.all(
          color: filled ? const Color(0xFFD0AA5A) : const Color(0xFFF0EFED),
          width: 1.4,
        ),
      ),
      child: Icon(
        Icons.bakery_dining_outlined,
        color: filled
            ? Colors.white
            : const Color(0xFFE5E2DD).withValues(alpha: 0.78),
        size: 22,
      ),
    );
  }
}

class _RewardState {
  const _RewardState({required this.remaining, required this.progress});

  final int remaining;
  final double progress;

  factory _RewardState.fromPurchases(int purchases, int target) {
    final safeTarget = max(target, 1);
    final capped = purchases.clamp(0, safeTarget);
    return _RewardState(
      remaining: max(safeTarget - purchases, 0),
      progress: capped / safeTarget,
    );
  }
}

int _recentPurchaseCount(List<BonusTransaction> transactions) {
  final threshold = DateTime.now().subtract(const Duration(days: 30));
  final orderKeys = <String>{};
  for (final tx in transactions) {
    if (!tx.isEarning && (tx.orderTotal ?? 0) <= 0) continue;
    final parsed = DateTime.tryParse(tx.timestamp);
    if (parsed == null || !parsed.toLocal().isAfter(threshold)) continue;
    final key = (tx.orderId ?? '').isEmpty ? tx.id : tx.orderId!;
    orderKeys.add(key);
  }
  return orderKeys.length;
}
