part of '../main.dart';

class RewardsScreen extends StatefulWidget {
  const RewardsScreen({required this.api, super.key});

  final BulkaApiClient api;

  @override
  State<RewardsScreen> createState() => _RewardsScreenState();
}

class _RewardsScreenState extends State<RewardsScreen> {
  final _referralController = TextEditingController();
  final _giftController = TextEditingController();
  Map<String, dynamic>? _referral;
  bool _loading = true;
  bool _submitting = false;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  @override
  void dispose() {
    _referralController.dispose();
    _giftController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final referral = await widget.api.getReferral();
      if (mounted) setState(() => _referral = referral);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _message(String value) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value)));
  }

  Future<void> _redeemReferral() async {
    if (_referralController.text.trim().isEmpty || _submitting) return;
    setState(() => _submitting = true);
    try {
      await widget.api.redeemReferral(_referralController.text);
      _referralController.clear();
      _message('rewards_referral_accepted'.tr);
    } catch (error) {
      _message(localizeErrorMessage(error));
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  Future<void> _redeemGift() async {
    if (_giftController.text.trim().isEmpty || _submitting) return;
    setState(() => _submitting = true);
    try {
      final amount = await widget.api.redeemGiftCard(_giftController.text);
      _giftController.clear();
      _message(
        'rewards_bonus_credited'.trArgs({'amount': _formatCartMoney(amount)}),
      );
    } catch (error) {
      _message(localizeErrorMessage(error));
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final code = _asString(_referral?['code']);
    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      appBar: AppBar(
        toolbarHeight: BulkaLayout.appBarHeight(context),
        backgroundColor: Theme.of(context).colorScheme.surface,
        title: _BulkaPageTitle('rewards_title'.tr),
        centerTitle: true,
        actions: const [SizedBox(width: BulkaLayout.appBarSideSlot)],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: _bulkaYellow))
          : ListView(
              padding: const EdgeInsets.fromLTRB(18, 20, 18, 36),
              children: [
                _RewardsCard(
                  icon: Icons.group_add_outlined,
                  title: 'rewards_invite_friend'.tr,
                  description: 'rewards_invite_description'.tr,
                  child: Container(
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: _lightCardHighlight,
                      borderRadius: BorderRadius.circular(BulkaRadii.control),
                    ),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(
                            code,
                            style: const TextStyle(
                              fontFamily: _headingFont,
                              fontSize: BulkaTypeScale.titleSmall,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                        IconButton(
                          onPressed: code.isEmpty
                              ? null
                              : () async {
                                  await Clipboard.setData(
                                    ClipboardData(text: code),
                                  );
                                  _message('rewards_code_copied'.tr);
                                },
                          icon: const Icon(Icons.copy_rounded),
                          tooltip: 'rewards_copy'.tr,
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                _RewardsCard(
                  icon: Icons.redeem_outlined,
                  title: 'rewards_have_friend_code'.tr,
                  description: 'rewards_friend_code_description'.tr,
                  child: Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: _referralController,
                          textCapitalization: TextCapitalization.characters,
                          decoration: const InputDecoration(
                            hintText: 'BULKA-XXXX',
                          ),
                        ),
                      ),
                      const SizedBox(width: 10),
                      FilledButton(
                        onPressed: _submitting ? null : _redeemReferral,
                        style: FilledButton.styleFrom(
                          minimumSize: const Size(52, 52),
                          backgroundColor: _bulkaYellow,
                          foregroundColor: _textDark,
                        ),
                        child: const Icon(Icons.arrow_forward_rounded),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
                _RewardsCard(
                  icon: Icons.card_giftcard_rounded,
                  title: 'rewards_gift_certificate'.tr,
                  description: 'rewards_gift_description'.tr,
                  child: Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: _giftController,
                          textCapitalization: TextCapitalization.characters,
                          decoration: const InputDecoration(
                            hintText: 'BLK-XXXX',
                          ),
                        ),
                      ),
                      const SizedBox(width: 10),
                      FilledButton(
                        onPressed: _submitting ? null : _redeemGift,
                        style: FilledButton.styleFrom(
                          minimumSize: const Size(52, 52),
                          backgroundColor: _bulkaYellow,
                          foregroundColor: _textDark,
                        ),
                        child: const Icon(Icons.check_rounded),
                      ),
                    ],
                  ),
                ),
              ],
            ),
    );
  }
}

class _RewardsCard extends StatelessWidget {
  const _RewardsCard({
    required this.icon,
    required this.title,
    required this.description,
    required this.child,
  });

  final IconData icon;
  final String title;
  final String description;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        borderRadius: BorderRadius.circular(BulkaRadii.card),
        border: Border.all(color: context.bulkaColors.cardBorder),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: context.bulkaColors.brandBrown, size: 30),
          const SizedBox(height: 12),
          Text(
            title,
            style: const TextStyle(
              fontFamily: _headingFont,
              fontSize: BulkaTypeScale.titleSmall,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 5),
          Text(
            description,
            style: TextStyle(
              color: context.bulkaColors.mutedText,
              height: 1.35,
            ),
          ),
          const SizedBox(height: 16),
          child,
        ],
      ),
    );
  }
}
