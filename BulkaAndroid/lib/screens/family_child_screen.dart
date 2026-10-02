part of '../main.dart';

class FamilyChildScreen extends StatefulWidget {
  const FamilyChildScreen({
    required this.api,
    required this.customer,
    required this.onLogout,
    required this.onRefresh,
    super.key,
  });
  final BulkaApiClient api;
  final Customer customer;
  final Future<void> Function() onLogout;
  final Future<void> Function() onRefresh;
  @override
  State<FamilyChildScreen> createState() => _FamilyChildScreenState();
}

class _FamilyChildScreenState extends State<FamilyChildScreen> {
  bool _payment = false;
  bool _leaving = false;
  String? _error;

  @override
  void didUpdateWidget(FamilyChildScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (_asDouble(widget.customer.family?['dailyLimit']) <= 0) _payment = false;
  }

  Future<void> _logout() async {
    if (_leaving) return;
    setState(() {
      _leaving = true;
      _error = null;
    });
    try {
      await widget.onLogout();
    } catch (error) {
      if (mounted) setState(() => _error = _familyError(error));
    } finally {
      if (mounted) setState(() => _leaving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final family = widget.customer.family ?? {};
    final canPay = _asDouble(family['dailyLimit']) > 0;
    return Scaffold(
      backgroundColor: _familyCanvas(context),
      appBar: AppBar(
        backgroundColor: _familyCanvas(context),
        title: _BulkaPageTitle(_familyText('title')),
        automaticallyImplyLeading: false,
        actions: [
          IconButton(
            onPressed: _leaving ? null : _logout,
            tooltip: 'logout_confirm_yes'.tr,
            icon: const Icon(Icons.logout_rounded),
          ),
        ],
      ),
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: widget.onRefresh,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
            children: [
              Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 420),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Row(
                        children: [
                          _FamilyAvatar(
                            name: widget.customer.name,
                            child: true,
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  widget.customer.name,
                                  style: const TextStyle(
                                    fontFamily: _headingFont,
                                    fontSize: 18,
                                  ),
                                ),
                                const SizedBox(height: 2),
                                Text(
                                  _asString(family['ownerName']),
                                  style: TextStyle(
                                    fontSize: 12,
                                    color: context.bulkaColors.mutedText,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),
                      _FamilyBonusHero(balance: widget.customer.balance),
                      const SizedBox(height: 12),
                      _FamilyPanel(
                        child: Column(
                          children: [
                            if (canPay) ...[
                              SizedBox(
                                width: double.infinity,
                                child: SegmentedButton<bool>(
                                  showSelectedIcon: false,
                                  style: SegmentedButton.styleFrom(
                                    selectedBackgroundColor:
                                        context.bulkaColors.brandBrown,
                                    selectedForegroundColor: Colors.white,
                                    backgroundColor:
                                        context.bulkaColors.disabledSurface,
                                    side: BorderSide.none,
                                    minimumSize: const Size(0, 44),
                                    textStyle: const TextStyle(
                                      fontFamily: _headingFont,
                                      fontSize: 12,
                                    ),
                                  ),
                                  segments: [
                                    ButtonSegment(
                                      value: false,
                                      label: Text(
                                        _familyText('loyalty'),
                                        maxLines: 1,
                                        softWrap: false,
                                      ),
                                    ),
                                    ButtonSegment(
                                      value: true,
                                      label: Text(
                                        _familyText('payment'),
                                        maxLines: 1,
                                        softWrap: false,
                                      ),
                                    ),
                                  ],
                                  selected: {_payment},
                                  onSelectionChanged: (values) =>
                                      setState(() => _payment = values.first),
                                ),
                              ),
                              const SizedBox(height: 12),
                            ],
                            FamilyQrWidget(api: widget.api, payment: _payment),
                          ],
                        ),
                      ),
                      if (canPay) ...[
                        const SizedBox(height: 12),
                        _FamilyAllowance(
                          remaining: _asDouble(family['remainingToday']),
                          limit: _asDouble(family['dailyLimit']),
                        ),
                      ],
                      if (_error != null)
                        Padding(
                          padding: const EdgeInsets.only(top: 16),
                          child: _InlineAlert(
                            message: _error!,
                            icon: Icons.info_outline,
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
    );
  }
}
