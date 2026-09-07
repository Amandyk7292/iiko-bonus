part of '../main.dart';

class BalanceHistoryScreen extends StatefulWidget {
  const BalanceHistoryScreen({
    required this.transactions,
    this.api,
    this.phone,
    this.onExplore,
    super.key,
  });

  final BulkaApiClient? api;
  final String? phone;
  final List<BonusTransaction> transactions;
  final VoidCallback? onExplore;

  @override
  State<BalanceHistoryScreen> createState() => _BalanceHistoryScreenState();
}

class _BalanceHistoryScreenState extends State<BalanceHistoryScreen> {
  late List<BonusTransaction> transactions;
  _LiveRefresh? _live;
  @override
  void initState() {
    super.initState();
    transactions = widget.transactions;
    final api = widget.api;
    if (api != null && widget.phone != null) {
      _live = _LiveRefresh(
        api,
        {
          'loyalty',
          'loyalty.balance.updated',
          'transaction.created',
          'customer.updated',
        },
        () async {
          if (!api.isAuthenticated) return;
          final scope = api.sessionCacheScope;
          final profile = await api.getProfile(widget.phone!);
          if (mounted && scope == api.sessionCacheScope) {
            setState(() => transactions = profile.transactions);
          }
        },
      );
    }
  }

  @override
  void dispose() {
    _live?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final items = List<BonusTransaction>.of(transactions)
      ..sort(
        (a, b) => (DateTime.tryParse(b.timestamp)?.millisecondsSinceEpoch ?? 0)
            .compareTo(
              DateTime.tryParse(a.timestamp)?.millisecondsSinceEpoch ?? 0,
            ),
      );
    final colors = context.bulkaColors;
    return Scaffold(
      backgroundColor: colors.surfaceCream,
      appBar: AppBar(
        backgroundColor: colors.surfaceCream,
        surfaceTintColor: Colors.transparent,
        toolbarHeight: BulkaLayout.appBarHeight(context),
        centerTitle: true,
        leadingWidth: 64,
        leading: Padding(
          padding: const EdgeInsets.only(left: 16),
          child: Center(
            child: IconButton.outlined(
              onPressed: () => Navigator.of(context).maybePop(),
              tooltip: 'back_tooltip'.tr,
              style: IconButton.styleFrom(
                minimumSize: const Size(44, 44),
                foregroundColor: colors.brandBrown,
                side: BorderSide(color: colors.cardBorder),
                shape: const CircleBorder(),
              ),
              icon: const Icon(Icons.chevron_left_rounded, size: 28),
            ),
          ),
        ),
        title: Text(
          'balance_history_title'.tr.toUpperCase(),
          style: TextStyle(
            color: colors.brandBrown,
            fontSize: 17,
            fontWeight: FontWeight.w700,
          ),
        ),
        actions: const [SizedBox(width: 64)],
      ),
      body: items.isEmpty
          ? Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Text(
                  'balance_history_empty'.tr,
                  style: TextStyle(color: colors.mutedText, fontSize: 16),
                ),
              ),
            )
          : ListView.builder(
              padding: EdgeInsets.fromLTRB(
                24,
                8,
                24,
                MediaQuery.paddingOf(context).bottom + 24,
              ),
              itemCount: items.length,
              itemBuilder: (context, index) {
                final item = items[index];
                final date = DateTime.tryParse(item.timestamp)?.toLocal();
                final previous = index > 0
                    ? DateTime.tryParse(items[index - 1].timestamp)?.toLocal()
                    : null;
                final newDay =
                    date != null && !DateUtils.isSameDay(date, previous);
                return Column(
                  children: [
                    if (newDay)
                      Padding(
                        key: ValueKey(
                          'balance-day-${date.year}-${date.month}-${date.day}',
                        ),
                        padding: EdgeInsets.only(
                          top: index == 0 ? 18 : 28,
                          bottom: 22,
                        ),
                        child: Text(
                          MaterialLocalizations.of(
                            context,
                          ).formatMediumDate(date).toUpperCase(),
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            color: colors.mutedText,
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                            letterSpacing: 0.4,
                          ),
                        ),
                      ),
                    Padding(
                      padding: const EdgeInsets.only(bottom: 24),
                      child: TransactionCard(transaction: item),
                    ),
                  ],
                );
              },
            ),
    );
  }
}
