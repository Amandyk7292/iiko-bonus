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
  List<Map<String, dynamic>> _receivedGiftCards = const [];
  List<Map<String, dynamic>> _giftPurchaseHistory = const [];
  PendingGiftPurchase? _pendingGiftPurchase;
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

  Future<T?> _optional<T>(Future<T> operation) async {
    try {
      return await operation;
    } catch (_) {
      return null;
    }
  }

  Future<void> _load() async {
    final referralFuture = _optional(widget.api.getReferral());
    final receivedGiftCardsFuture = _optional(
      widget.api.getReceivedGiftCards(),
    );
    final giftPurchaseHistoryFuture = _optional(
      widget.api.getGiftCertificatePurchases(),
    );
    final pendingGiftPurchaseFuture = PendingGiftPurchaseStore.load(widget.api);
    final referral = await referralFuture;
    final receivedGiftCards = await receivedGiftCardsFuture ?? const [];
    final giftPurchaseHistory = await giftPurchaseHistoryFuture ?? const [];
    var pendingGiftPurchase = await pendingGiftPurchaseFuture;
    _GiftPurchaseResult? recoveredPurchase;
    final pendingPurchaseId = pendingGiftPurchase?.purchaseId;
    if (pendingGiftPurchase != null && pendingPurchaseId?.isNotEmpty == true) {
      try {
        final purchase = await widget.api.getGiftCertificatePurchase(
          pendingPurchaseId!,
        );
        final status = _asString(purchase['status']).trim().toLowerCase();
        if (status == 'active') {
          recoveredPurchase = _GiftPurchaseResult.fromPurchase(
            purchase,
            fallback: pendingGiftPurchase,
          );
          await PendingGiftPurchaseStore.clear(widget.api);
          pendingGiftPurchase = null;
        } else if (const {
          'failed',
          'expired',
          'refunded',
          'cancelled',
          'canceled',
        }.contains(status)) {
          await PendingGiftPurchaseStore.clear(widget.api);
          pendingGiftPurchase = null;
        }
      } catch (_) {
        // Keep it visible so the customer can safely retry with the same ID.
      }
    }
    if (!mounted) return;
    setState(() {
      _referral = referral ?? _referral;
      _receivedGiftCards = receivedGiftCards;
      _giftPurchaseHistory = giftPurchaseHistory;
      _pendingGiftPurchase = pendingGiftPurchase;
      _loading = false;
    });
    if (recoveredPurchase != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) unawaited(_finishGiftPurchase(recoveredPurchase!));
      });
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

  Future<void> _purchaseGift() async {
    final result = await showModalBottomSheet<_GiftPurchaseResult>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => _GiftCertificatePurchaseSheet(
        api: widget.api,
        initialDraft: _pendingGiftPurchase,
      ),
    );
    if (!mounted || result == null) return;
    await _finishGiftPurchase(result);
    if (mounted) unawaited(_load());
  }

  Future<void> _finishGiftPurchase(_GiftPurchaseResult result) async {
    if (result.recipientRegistered) {
      _message('gift_purchase_success_registered'.tr);
      return;
    }
    if (result.code == null) {
      _message('gift_purchase_code_preparing'.tr);
      return;
    }
    _message('gift_purchase_success_share'.tr);
    await _showGiftCode(result);
  }

  Future<void> _showGiftCode(_GiftPurchaseResult result) async {
    final code = result.code;
    if (code == null || !mounted) return;
    await showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text('gift_code_ready'.tr),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              result.recipientRegistered
                  ? 'gift_code_hint_registered'.tr
                  : 'gift_code_hint_unregistered'.tr,
            ),
            const SizedBox(height: 16),
            SelectableText(
              code,
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontFamily: _headingFont,
                fontSize: BulkaTypeScale.titleLarge,
                fontWeight: FontWeight.w700,
                letterSpacing: 1.2,
              ),
            ),
          ],
        ),
        actions: [
          TextButton.icon(
            onPressed: () async {
              await Clipboard.setData(ClipboardData(text: code));
              if (!dialogContext.mounted) return;
              ScaffoldMessenger.of(
                dialogContext,
              ).showSnackBar(SnackBar(content: Text('gift_code_copied'.tr)));
            },
            icon: const Icon(Icons.copy_rounded),
            label: Text('gift_copy_code'.tr),
          ),
          FilledButton.icon(
            onPressed: () async {
              final phone = result.phone.replaceAll(RegExp(r'\D'), '');
              final text = 'gift_share_message'.trArgs({
                'amount': _formatCartMoney(result.amount),
                'code': code,
              });
              final opened = await launchUrl(
                Uri.https('wa.me', '/$phone', {'text': text}),
                mode: LaunchMode.externalApplication,
              );
              if (!opened) {
                await Clipboard.setData(ClipboardData(text: text));
              }
            },
            icon: const Icon(Icons.send_rounded),
            label: Text('gift_send_whatsapp'.tr),
          ),
        ],
      ),
    );
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
                if (_pendingGiftPurchase != null) ...[
                  _RewardsCard(
                    icon: Icons.pending_actions_rounded,
                    title: 'gift_pending_title'.tr,
                    description: 'gift_pending_description'.trArgs({
                      'amount': _formatCartMoney(_pendingGiftPurchase!.amount),
                      'phone': _pendingGiftPurchase!.recipientPhone,
                    }),
                    child: FilledButton.icon(
                      onPressed: _purchaseGift,
                      icon: const Icon(Icons.play_arrow_rounded),
                      label: Text('gift_pending_continue'.tr),
                      style: FilledButton.styleFrom(
                        minimumSize: const Size.fromHeight(52),
                        backgroundColor: _bulkaYellow,
                        foregroundColor: _textDark,
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),
                ],
                if (_receivedGiftCards.isNotEmpty) ...[
                  _RewardsCard(
                    icon: Icons.wallet_giftcard_rounded,
                    title: 'gift_received_title'.tr,
                    description: 'gift_received_description'.tr,
                    child: Column(
                      children: [
                        for (final card in _receivedGiftCards)
                          _ReceivedGiftCardTile(
                            card: card,
                            onRedeem: _submitting
                                ? null
                                : () => _redeemReceivedGift(card),
                          ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),
                ],
                _RewardsCard(
                  icon: Icons.redeem_rounded,
                  title: 'gift_purchase_title'.tr,
                  description: 'gift_purchase_description'.tr,
                  child: FilledButton.icon(
                    onPressed: _submitting ? null : _purchaseGift,
                    icon: const Icon(Icons.card_giftcard_rounded),
                    label: Text('gift_purchase_action'.tr),
                    style: FilledButton.styleFrom(
                      minimumSize: const Size.fromHeight(52),
                      backgroundColor: _bulkaYellow,
                      foregroundColor: _textDark,
                    ),
                  ),
                ),
                const SizedBox(height: 16),
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
                  child: _RewardsCodeField(
                    controller: _referralController,
                    hintText: 'BULKA-XXXX',
                    onApply: _submitting ? null : _redeemReferral,
                  ),
                ),
                const SizedBox(height: 16),
                _RewardsCard(
                  icon: Icons.card_giftcard_rounded,
                  title: 'rewards_gift_certificate'.tr,
                  description: 'rewards_gift_description'.tr,
                  child: _RewardsCodeField(
                    controller: _giftController,
                    hintText: 'BLK-XXXX',
                    onApply: _submitting ? null : _redeemGift,
                  ),
                ),
                if (_giftPurchaseHistory.isNotEmpty) ...[
                  const SizedBox(height: 16),
                  _RewardsCard(
                    icon: Icons.history_rounded,
                    title: 'gift_history_title'.tr,
                    description: 'gift_history_description'.tr,
                    child: Column(
                      children: [
                        for (final purchase in _giftPurchaseHistory)
                          _GiftPurchaseHistoryTile(
                            purchase: purchase,
                            onShare: () {
                              final result = _GiftPurchaseResult.fromPurchase(
                                purchase,
                              );
                              if (result.code != null) {
                                unawaited(_showGiftCode(result));
                              }
                            },
                          ),
                      ],
                    ),
                  ),
                ],
              ],
            ),
    );
  }

  Future<void> _redeemReceivedGift(Map<String, dynamic> card) async {
    final code = _asString(card['code']).trim();
    if (code.isEmpty || _submitting) return;
    setState(() => _submitting = true);
    try {
      final amount = await widget.api.redeemGiftCard(code);
      _message(
        'rewards_bonus_credited'.trArgs({'amount': _formatCartMoney(amount)}),
      );
      await _load();
    } catch (error) {
      _message(localizeErrorMessage(error));
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }
}

class _GiftCertificatePurchaseSheet extends StatefulWidget {
  const _GiftCertificatePurchaseSheet({required this.api, this.initialDraft});

  final BulkaApiClient api;
  final PendingGiftPurchase? initialDraft;

  @override
  State<_GiftCertificatePurchaseSheet> createState() =>
      _GiftCertificatePurchaseSheetState();
}

class _GiftPurchaseResult {
  const _GiftPurchaseResult({
    required this.phone,
    required this.amount,
    required this.recipientRegistered,
    this.code,
    this.purchaseId,
  });

  final String phone;
  final int amount;
  final bool recipientRegistered;
  final String? code;
  final String? purchaseId;

  factory _GiftPurchaseResult.fromPurchase(
    Map<String, dynamic> purchase, {
    PendingGiftPurchase? fallback,
  }) {
    final recipient = _asMap(purchase['recipient']);
    final giftCard = _asMap(purchase['giftCard']);
    final deliveryMode = _asString(
      purchase['deliveryMode'] ?? recipient['deliveryMode'],
    ).trim();
    return _GiftPurchaseResult(
      phone:
          _asString(recipient['phone']).trim().nullIfEmpty ??
          fallback?.recipientPhone ??
          '',
      amount:
          (purchase['amount'] as num?)?.round() ??
          fallback?.amount ??
          (giftCard['balance'] as num?)?.round() ??
          0,
      recipientRegistered:
          recipient['registered'] == true || deliveryMode == 'in_app',
      code: _asString(giftCard['code']).trim().nullIfEmpty,
      purchaseId: _asString(purchase['id']).trim().nullIfEmpty,
    );
  }
}

class _GiftCertificatePurchaseSheetState
    extends State<_GiftCertificatePurchaseSheet> {
  final _formKey = GlobalKey<FormState>();
  final _amountController = TextEditingController();
  final _phoneController = TextEditingController(text: '+7 ');
  final _nameController = TextEditingController();
  final _messageController = TextEditingController();
  int? _presetAmount = 5000;
  final String _paymentMethod = 'forte';
  PendingGiftPurchase? _draft;
  bool _draftWasSubmitted = false;
  bool _submitting = false;

  @override
  void initState() {
    super.initState();
    _draft = widget.initialDraft;
    _draftWasSubmitted = _draft != null;
    final draft = _draft;
    if (draft != null) {
      if (const [3000, 5000, 10000, 15000].contains(draft.amount)) {
        _presetAmount = draft.amount;
      } else {
        _presetAmount = null;
        _amountController.text = draft.amount.toString();
      }
      _phoneController.text = draft.recipientPhone;
      _nameController.text = draft.recipientName ?? '';
      _messageController.text = draft.message ?? '';
    }
  }

  @override
  void dispose() {
    _amountController.dispose();
    _phoneController.dispose();
    _nameController.dispose();
    _messageController.dispose();
    super.dispose();
  }

  int? get _amount {
    if (_presetAmount != null) return _presetAmount;
    return int.tryParse(_amountController.text.replaceAll(RegExp(r'\D'), ''));
  }

  String? get _normalizedPhone {
    final digits = _phoneController.text.replaceAll(RegExp(r'\D'), '');
    if (digits.length == 10) return '+7$digits';
    if (digits.length != 11) return null;
    if (digits.startsWith('8')) return '+7${digits.substring(1)}';
    if (digits.startsWith('7')) return '+$digits';
    return null;
  }

  Future<void> _submit() async {
    if (_submitting || !_formKey.currentState!.validate()) return;
    final amount = _amount;
    final phone = _normalizedPhone;
    if (amount == null || amount < 500 || phone == null) return;
    final recipientName = _nameController.text.trim();
    final message = _messageController.text.trim();
    var draft = _draft;
    if (draft == null ||
        !draft.matches(
          amount: amount,
          recipientPhone: phone,
          recipientName: recipientName,
          message: message,
          paymentMethod: _paymentMethod,
        )) {
      draft = PendingGiftPurchase(
        requestId: _newCheckoutId(),
        amount: amount,
        recipientPhone: phone,
        recipientName: recipientName.nullIfEmpty,
        message: message.nullIfEmpty,
        paymentMethod: _paymentMethod,
        createdAt: DateTime.now(),
      );
    }
    _draft = draft;
    _draftWasSubmitted = true;
    await PendingGiftPurchaseStore.save(widget.api, draft);
    if (!mounted) return;
    setState(() => _submitting = true);
    try {
      final result = await widget.api.createGiftCertificatePurchase(
        requestId: draft.requestId,
        amount: amount,
        recipientPhone: phone,
        recipientName: recipientName,
        message: message,
        paymentMethod: _paymentMethod,
      );
      final purchase = _asMap(result['purchase']);
      final payment = _asMap(result['payment']);
      final purchaseStatus = _asString(purchase['status']).trim().toLowerCase();
      final purchaseId = _asString(purchase['id']).trim();
      if (purchaseId.isNotEmpty && draft.purchaseId != purchaseId) {
        draft = draft.withPurchaseId(purchaseId);
        _draft = draft;
        await PendingGiftPurchaseStore.save(widget.api, draft);
      }
      if (purchaseStatus == 'active') {
        await PendingGiftPurchaseStore.clear(widget.api);
        if (!mounted) return;
        Navigator.of(
          context,
        ).pop(_GiftPurchaseResult.fromPurchase(purchase, fallback: draft));
        return;
      }
      final operationId = _asString(payment['operationId']);
      final checkoutUrl = _asString(payment['checkoutUrl']);
      if (operationId.isEmpty) {
        throw ApiException('checkout_operation_missing'.tr);
      }
      if (!mounted) return;
      if (checkoutUrl.isEmpty) {
        throw ApiException('error_forte_payment'.tr);
      }
      final paymentResult = await Navigator.of(context)
          .push<FortePaymentResult>(
            MaterialPageRoute(
              builder: (_) => FortePaymentScreen(
                api: widget.api,
                operationId: operationId,
                redirectUrl: checkoutUrl,
                checkoutId: _asString(purchase['id']),
              ),
            ),
          );
      final paid = paymentResult?.paid == true;
      if (!mounted) return;
      if (paid) {
        final activated = purchaseId.isEmpty
            ? <String, dynamic>{}
            : await _waitForGiftPurchase(purchaseId);
        if (!mounted) return;
        final activationStatus = _asString(
          activated['status'],
        ).trim().toLowerCase();
        if (activationStatus != 'active') {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('gift_purchase_code_preparing'.tr)),
          );
          return;
        }
        await PendingGiftPurchaseStore.clear(widget.api);
        if (!mounted) return;
        Navigator.of(
          context,
        ).pop(_GiftPurchaseResult.fromPurchase(activated, fallback: draft));
      } else {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('gift_purchase_pending'.tr)));
      }
    } catch (error) {
      if (mounted) {
        showApiErrorSnackBar(
          context,
          error,
          fallbackKey: 'gift_purchase_error',
        );
      }
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  Future<Map<String, dynamic>> _waitForGiftPurchase(String purchaseId) async {
    for (var attempt = 0; attempt < 10; attempt++) {
      try {
        final purchase = await widget.api.getGiftCertificatePurchase(
          purchaseId,
        );
        if (_asString(purchase['status']).trim().toLowerCase() == 'active') {
          return purchase;
        }
      } catch (_) {
        // Payment activation can briefly lag behind the bank status.
      }
      if (attempt < 9) await Future<void>.delayed(const Duration(seconds: 1));
    }
    return const {};
  }

  void _replaceSubmittedDraft() {
    if (_draft == null || !_draftWasSubmitted) return;
    _draft = null;
    _draftWasSubmitted = false;
    unawaited(PendingGiftPurchaseStore.clear(widget.api));
  }

  @override
  Widget build(BuildContext context) {
    final keyboardInset = MediaQuery.viewInsetsOf(context).bottom;
    return PopScope(
      canPop: !_submitting,
      child: Padding(
        padding: EdgeInsets.fromLTRB(20, 16, 20, keyboardInset + 24),
        child: SingleChildScrollView(
          child: Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        'gift_purchase_title'.tr,
                        style: const TextStyle(
                          fontFamily: _headingFont,
                          fontSize: BulkaTypeScale.titleLarge,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                    IconButton(
                      tooltip: 'close_btn'.tr,
                      onPressed: _submitting
                          ? null
                          : () => Navigator.of(context).pop(),
                      icon: const Icon(Icons.close_rounded),
                      style: IconButton.styleFrom(
                        minimumSize: const Size(48, 48),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 18),
                Text(
                  'gift_amount_label'.tr,
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 10),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    for (final amount in const [3000, 5000, 10000, 15000])
                      ChoiceChip(
                        label: Text('${_formatCartMoney(amount)} ₸'),
                        selected: _presetAmount == amount,
                        onSelected: _submitting
                            ? null
                            : (_) {
                                _replaceSubmittedDraft();
                                setState(() {
                                  _presetAmount = amount;
                                  _amountController.clear();
                                });
                              },
                      ),
                    ChoiceChip(
                      label: Text('gift_custom_amount'.tr),
                      selected: _presetAmount == null,
                      onSelected: _submitting
                          ? null
                          : (_) {
                              _replaceSubmittedDraft();
                              setState(() => _presetAmount = null);
                            },
                    ),
                  ],
                ),
                if (_presetAmount == null) ...[
                  const SizedBox(height: 10),
                  TextFormField(
                    controller: _amountController,
                    keyboardType: TextInputType.number,
                    inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                    onChanged: (_) => _replaceSubmittedDraft(),
                    decoration: InputDecoration(
                      labelText: 'gift_custom_amount'.tr,
                      suffixText: '₸',
                    ),
                    validator: (_) {
                      final amount = _amount;
                      return amount == null || amount < 500
                          ? 'gift_amount_error'.tr
                          : null;
                    },
                  ),
                ],
                const SizedBox(height: 16),
                TextFormField(
                  controller: _phoneController,
                  keyboardType: TextInputType.phone,
                  autofillHints: const [AutofillHints.telephoneNumber],
                  onChanged: (_) => _replaceSubmittedDraft(),
                  decoration: InputDecoration(
                    labelText: 'gift_recipient_phone'.tr,
                    prefixIcon: const Icon(Icons.phone_outlined),
                  ),
                  validator: (_) =>
                      _normalizedPhone == null ? 'gift_phone_error'.tr : null,
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _nameController,
                  textCapitalization: TextCapitalization.words,
                  autofillHints: const [AutofillHints.name],
                  onChanged: (_) => _replaceSubmittedDraft(),
                  decoration: InputDecoration(
                    labelText: 'gift_recipient_name'.tr,
                  ),
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _messageController,
                  minLines: 2,
                  maxLines: 4,
                  maxLength: 300,
                  textCapitalization: TextCapitalization.sentences,
                  onChanged: (_) => _replaceSubmittedDraft(),
                  decoration: InputDecoration(labelText: 'gift_message'.tr),
                ),
                const SizedBox(height: 6),
                Text(
                  'gift_payment_method'.tr,
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 8),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 14,
                  ),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(BulkaRadii.control),
                    border: Border.all(color: context.bulkaColors.cardBorder),
                  ),
                  child: const Row(
                    children: [
                      Icon(Icons.credit_card_rounded),
                      SizedBox(width: 12),
                      Text(
                        'Visa / Mastercard',
                        style: TextStyle(fontWeight: FontWeight.w700),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 20),
                FilledButton(
                  onPressed: _submitting ? null : _submit,
                  style: FilledButton.styleFrom(
                    minimumSize: const Size.fromHeight(54),
                    backgroundColor: _bulkaYellow,
                    foregroundColor: _textDark,
                  ),
                  child: _submitting
                      ? const SizedBox.square(
                          dimension: 22,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : Text('gift_pay_and_send'.tr),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _ReceivedGiftCardTile extends StatelessWidget {
  const _ReceivedGiftCardTile({required this.card, required this.onRedeem});

  final Map<String, dynamic> card;
  final VoidCallback? onRedeem;

  @override
  Widget build(BuildContext context) {
    final senderName = _asString(card['senderName']).trim();
    final message = _asString(card['message']).trim();
    final code = _asString(card['code']).trim();
    final balance = (card['balance'] as num?)?.round() ?? 0;
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: _lightCardHighlight,
        borderRadius: BorderRadius.circular(BulkaRadii.control),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            senderName.isEmpty
                ? 'gift_received_from_bulka'.tr
                : 'gift_received_from'.trArgs({'name': senderName}),
            style: const TextStyle(fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 4),
          Text(
            '${_formatCartMoney(balance)} ₸ · •••• ${_asString(card['last4'])}',
          ),
          if (message.isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(
              '“$message”',
              style: TextStyle(color: context.bulkaColors.mutedText),
            ),
          ],
          if (code.isNotEmpty) ...[
            const SizedBox(height: 10),
            FilledButton(
              onPressed: onRedeem,
              style: FilledButton.styleFrom(
                minimumSize: const Size.fromHeight(46),
                backgroundColor: _bulkaYellow,
                foregroundColor: _textDark,
              ),
              child: Text('gift_received_redeem'.tr),
            ),
          ],
        ],
      ),
    );
  }
}

class _GiftPurchaseHistoryTile extends StatelessWidget {
  const _GiftPurchaseHistoryTile({
    required this.purchase,
    required this.onShare,
  });

  final Map<String, dynamic> purchase;
  final VoidCallback onShare;

  @override
  Widget build(BuildContext context) {
    final recipient = _asMap(purchase['recipient']);
    final giftCard = _asMap(purchase['giftCard']);
    final code = _asString(giftCard['code']).trim();
    final status = _asString(purchase['status']).trim().toLowerCase();
    final statusKey = switch (status) {
      'active' => 'gift_status_active',
      'failed' => 'gift_status_failed',
      'expired' => 'gift_status_expired',
      'refunded' => 'gift_status_refunded',
      _ => 'gift_status_pending',
    };
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: _lightCardHighlight,
        borderRadius: BorderRadius.circular(BulkaRadii.control),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${_formatCartMoney((purchase['amount'] as num?)?.round() ?? 0)} ₸',
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 3),
                Text(
                  _asString(recipient['phone']),
                  style: TextStyle(color: context.bulkaColors.mutedText),
                ),
                const SizedBox(height: 3),
                Text(statusKey.tr),
              ],
            ),
          ),
          if (code.isNotEmpty)
            IconButton(
              onPressed: onShare,
              tooltip: 'gift_share_again'.tr,
              icon: const Icon(Icons.ios_share_rounded),
            ),
        ],
      ),
    );
  }
}

class _RewardsCodeField extends StatelessWidget {
  const _RewardsCodeField({
    required this.controller,
    required this.hintText,
    required this.onApply,
  });

  final TextEditingController controller;
  final String hintText;
  final VoidCallback? onApply;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final textScale = MediaQuery.textScalerOf(context).scale(1);
        final vertical = constraints.maxWidth < 340 || textScale > 1.35;
        final field = TextField(
          controller: controller,
          textCapitalization: TextCapitalization.characters,
          decoration: InputDecoration(hintText: hintText),
        );
        final action = FilledButton(
          onPressed: onApply,
          style: FilledButton.styleFrom(
            minimumSize: const Size(0, 52),
            backgroundColor: _bulkaYellow,
            foregroundColor: _textDark,
          ),
          child: Text('apply_btn'.tr),
        );
        if (vertical) {
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              field,
              const SizedBox(height: 10),
              SizedBox(width: double.infinity, child: action),
            ],
          );
        }
        return Row(
          children: [
            Expanded(child: field),
            const SizedBox(width: 10),
            action,
          ],
        );
      },
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
