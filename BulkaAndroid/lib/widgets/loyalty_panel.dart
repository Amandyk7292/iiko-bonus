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
    final balance = formatMoney(customer.balance);

    return AnimatedContainer(
      duration: const Duration(milliseconds: 220),
      curve: Curves.easeOutCubic,
      padding: EdgeInsets.zero,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            clipBehavior: Clip.antiAlias,
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(26),
              gradient: const LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [
                  Color(0xFFFFE082),
                  Color(0xFFFFD54F),
                  Color(0xFFFFB300),
                ],
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
                      borderRadius: BorderRadius.circular(34),
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
                              const Text(
                                'Покажите QR-\nкод кассиру',
                                style: TextStyle(
                                  color: Color(0xFF5A2E1E),
                                  fontFamily: _headingFont,
                                  fontSize: 22,
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
                                    foregroundColor: Colors.black,
                                    shape: RoundedRectangleBorder(
                                      borderRadius: BorderRadius.circular(18),
                                    ),
                                  ),
                                  child: const Text(
                                    'Открыть',
                                    style: TextStyle(
                                      fontSize: 18,
                                      fontWeight: FontWeight.w400,
                                    ),
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(width: 16),
                        InkWell(
                          onTap: onQrTap,
                          borderRadius: BorderRadius.circular(24),
                          child: _InlineQrPreview(api: api, customer: customer),
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
                              Text(
                                'Баланс: $balance баллов',
                                style: const TextStyle(
                                  color: Color(0xFF5A2E1E),
                                  fontFamily: _headingFont,
                                  fontSize: 20,
                                  fontWeight: FontWeight.w400,
                                ),
                              ),
                              const SizedBox(height: 8),
                              Text(
                                'Дарим ${customer.cashbackPercent}% кешбэк после каждой покупки!',
                                style: const TextStyle(
                                  color: Colors.black,
                                  fontSize: 16,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ],
                          ),
                        ),
                        Tooltip(
                          message: expanded ? 'Свернуть' : 'Развернуть',
                          child: GestureDetector(
                            behavior: HitTestBehavior.opaque,
                            onTap: onToggle,
                            child: SizedBox(
                              width: 44,
                              height: 44,
                              child: Center(
                                child: AnimatedRotation(
                                  turns: expanded ? 0.5 : 0,
                                  duration: const Duration(milliseconds: 180),
                                  child: const Icon(
                                    Icons.keyboard_arrow_down_rounded,
                                    color: Colors.black,
                                    size: 22,
                                  ),
                                ),
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
          AnimatedCrossFade(
            firstChild: const SizedBox.shrink(),
            secondChild: Padding(
              padding: const EdgeInsets.fromLTRB(0, 22, 0, 0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _RewardProgress(
                    title: '+1% кешбэк после 6 покупки в течение 30 дней.',
                    remaining: firstReward.remaining,
                    progress: firstReward.progress,
                  ),
                  const SizedBox(height: 22),
                  _RewardProgress(
                    title: '+1% кешбэк после 12 покупки в течение 30 дней.',
                    remaining: secondReward.remaining,
                    progress: secondReward.progress,
                  ),
                  const SizedBox(height: 24),
                  _StampRow(completed: purchaseCount, total: 12),
                  const SizedBox(height: 28),
                  SizedBox(
                    width: double.infinity,
                    height: 58,
                    child: GradientButton(
                      onPressed: onHistoryTap,
                      child: const Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(Icons.history, size: 20, color: Colors.white),
                          SizedBox(width: 8),
                          Text(
                            'История баланса',
                            style: TextStyle(
                              fontSize: 20,
                              fontWeight: FontWeight.w400,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
            crossFadeState: expanded
                ? CrossFadeState.showSecond
                : CrossFadeState.showFirst,
            duration: const Duration(milliseconds: 220),
          ),
        ],
      ),
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
      });
      _scheduleNextWindowRefresh();
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _token = null;
        _loading = false;
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
    return Container(
      width: 116,
      height: 116,
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
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
          ? const Icon(Icons.qr_code_2_rounded, color: _caramel, size: 58)
          : QrImageView(data: _token!, backgroundColor: Colors.white),
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
            fontSize: 19,
            height: 1.2,
            fontWeight: FontWeight.w400,
          ),
        ),
        const SizedBox(height: 14),
        Stack(
          clipBehavior: Clip.none,
          children: [
            Container(
              height: 8,
              decoration: BoxDecoration(
                color: const Color(0xFFF1F0EE),
                borderRadius: BorderRadius.circular(99),
              ),
            ),
            FractionallySizedBox(
              widthFactor: progress.clamp(0, 1),
              child: Container(
                height: 8,
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    colors: [Color(0xFFFFD54F), Color(0xFFFFB300)],
                  ),
                  borderRadius: BorderRadius.circular(99),
                ),
              ),
            ),
            Positioned(
              left: 0,
              right: 0,
              top: -12,
              child: Align(
                alignment: FractionalOffset(progress.clamp(0.0, 1.0), 0.5),
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
        const SizedBox(height: 20),
        Text(
          'Осталось покупок: $remaining',
          style: const TextStyle(
            color: Colors.black,
            fontSize: 20,
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
    return Container(
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
