import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:qr_flutter/qr_flutter.dart';
import '../core/url_navigation.dart';
import '../main.dart'
    show
        ApiException,
        BulkaApiClient,
        FortuneCustomerApi,
        PendingFortuneClaim,
        fortuneText,
        formatMoney,
        formatUiDate,
        BulkaRadii,
        BulkaThemeExt;

class FortunePrizesView extends StatefulWidget {
  const FortunePrizesView({
    required this.api,
    required this.pageTitle,
    required this.bindLiveRefresh,
    this.onRefreshProfile,
    super.key,
  });
  final BulkaApiClient api;
  final Widget Function(String) pageTitle;
  final VoidCallback Function(Future<void> Function(), bool Function())
  bindLiveRefresh;
  final Future<void> Function()? onRefreshProfile;

  @override
  State<FortunePrizesView> createState() => _FortunePrizesViewState();
}

class _FortunePrizesViewState extends State<FortunePrizesView> {
  List<Map<String, dynamic>> _prizes = const [];
  bool _loading = true;
  bool _claiming = false;
  String? _redeemingId;
  String? _error;
  String? _notice;
  late final VoidCallback _disposeLive;

  @override
  void initState() {
    super.initState();
    _disposeLive = widget.bindLiveRefresh(
      _load,
      () => _loading || _claiming || _redeemingId != null,
    );
    unawaited(_load());
  }

  @override
  void dispose() {
    _disposeLive();
    super.dispose();
  }

  Future<void> _load() async {
    if (_claiming || _redeemingId != null) return;
    final account = widget.api.sessionCacheScope;
    setState(() {
      _loading = true;
      _error = null;
    });
    final pending = await PendingFortuneClaim.read();
    if (!mounted ||
        !widget.api.isAuthenticated ||
        account != widget.api.sessionCacheScope) {
      return;
    }
    if (pending != null) {
      setState(() => _claiming = true);
      try {
        await widget.api.claimFortunePrize(pending);
        if (!mounted || account != widget.api.sessionCacheScope) return;
        await PendingFortuneClaim.clear(pending);
        final current = currentClientUri();
        if (PendingFortuneClaim.tokenFromFragment(current) == pending) {
          replaceClientUri(current.replace(fragment: ''));
        }
        _notice = fortuneText('claimed');
        if (widget.onRefreshProfile != null) {
          unawaited(widget.onRefreshProfile!());
        }
      } catch (error) {
        if (!mounted || account != widget.api.sessionCacheScope) return;
        final terminal =
            error is ApiException &&
            const {
              'FORTUNE_CLAIM_EXPIRED',
              'FORTUNE_CLAIM_INVALID',
              'FORTUNE_EXPIRED',
              'FORTUNE_ALREADY_CLAIMED',
              'FORTUNE_PRIZE_EXPIRED',
            }.contains(error.code);
        if (terminal) await PendingFortuneClaim.clear(pending);
        _error = fortuneText(terminal ? 'terminal' : 'claimError');
      } finally {
        if (mounted) setState(() => _claiming = false);
      }
    }
    try {
      final items = await widget.api.getFortunePrizes();
      if (!mounted || account != widget.api.sessionCacheScope) return;
      setState(() => _prizes = items);
    } catch (_) {
      if (mounted && account == widget.api.sessionCacheScope) {
        _error ??= fortuneText('loadError');
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: widget.pageTitle(fortuneText('title'))),
    body: SafeArea(
      child: _loading && !_claiming
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(20),
              children: [
                if (_claiming) ...[
                  const Center(child: CircularProgressIndicator()),
                  const SizedBox(height: 16),
                  Text(fortuneText('claiming'), textAlign: TextAlign.center),
                ],
                if (_notice != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 16),
                    child: Text(
                      _notice!,
                      style: const TextStyle(fontWeight: FontWeight.w700),
                    ),
                  ),
                if (_error != null) ...[
                  Text(
                    _error!,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                  const SizedBox(height: 8),
                  OutlinedButton(
                    onPressed: _loading ? null : _load,
                    child: Text(fortuneText('retry')),
                  ),
                  const SizedBox(height: 20),
                ],
                if (_prizes.isEmpty && !_loading && _error == null)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 44),
                    child: Column(
                      children: [
                        Icon(
                          Icons.qr_code_2_rounded,
                          size: 52,
                          color: context.bulkaColors.brandGold,
                        ),
                        const SizedBox(height: 20),
                        Text(
                          fortuneText('empty'),
                          textAlign: TextAlign.center,
                          style: const TextStyle(
                            fontSize: 21,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 10),
                        Text(
                          fortuneText('emptyHint'),
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            color: context.bulkaColors.mutedText,
                          ),
                        ),
                      ],
                    ),
                  ),
                for (final prize in _prizes)
                  _FortunePrizeCard(
                    prize: prize,
                    redeeming: _redeemingId == prize['id'],
                    onRedeem: _redeemingId != null
                        ? null
                        : () => _redeemBonus(prize),
                  ),
              ],
            ),
    ),
  );

  Future<void> _redeemBonus(Map<String, dynamic> prize) async {
    if (_redeemingId != null || _loading) return;
    final id = _string(prize['id']);
    final account = widget.api.sessionCacheScope;
    setState(() {
      _redeemingId = id;
      _error = null;
    });
    try {
      final updated = await widget.api.redeemFortuneBonus(id);
      if (!mounted || account != widget.api.sessionCacheScope) return;
      setState(() {
        _prizes = _prizes
            .map((item) => item['id'] == id ? updated : item)
            .toList(growable: false);
        _notice = fortuneText('credited');
      });
      if (widget.onRefreshProfile != null) {
        unawaited(widget.onRefreshProfile!());
      }
    } catch (error) {
      if (mounted && account == widget.api.sessionCacheScope) {
        setState(
          () => _error = fortuneText(
            error is ApiException && error.code == 'FORTUNE_EXPIRED'
                ? 'terminal'
                : 'redeemError',
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _redeemingId = null);
    }
  }
}

class _FortunePrizeCard extends StatelessWidget {
  const _FortunePrizeCard({
    required this.prize,
    required this.redeeming,
    this.onRedeem,
  });
  final Map<String, dynamic> prize;
  final bool redeeming;
  final VoidCallback? onRedeem;

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    final expiry = DateTime.tryParse(_string(prize['expiresAt']));
    final status = _string(prize['status']);
    final expired =
        status == 'expired' ||
        (expiry != null && expiry.isBefore(DateTime.now()));
    final redeemed = prize['redeemedAt'] != null || status == 'redeemed';
    final bonus = prize['prizeKind'] == 'bonus';
    final code = _string(prize['redemptionCode']);
    final active = !expired && !redeemed;
    return Container(
      margin: const EdgeInsets.only(bottom: 14),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: active
            ? colors.surfaceCream
            : Theme.of(context).colorScheme.surface,
        border: Border.all(color: colors.cardBorder),
        borderRadius: BorderRadius.circular(BulkaRadii.card),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(
                bonus
                    ? Icons.account_balance_wallet_outlined
                    : Icons.qr_code_2_rounded,
                color: active || bonus ? colors.brandGold : colors.mutedText,
                size: 28,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  _string(prize['prizeLabel']),
                  style: TextStyle(
                    color: colors.brandBrown,
                    fontSize: 20,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Text(
            fortuneText(
              redeemed
                  ? bonus
                        ? 'credited'
                        : 'redeemed'
                  : expired
                  ? 'expired'
                  : bonus
                  ? 'claimed'
                  : 'active',
            ),
            style: TextStyle(color: colors.mutedText),
          ),
          if (active && !bonus && code.isNotEmpty) ...[
            const SizedBox(height: 20),
            Center(
              child: Semantics(
                label: fortuneText('code'),
                child: QrImageView(
                  data: Uri.https('bulka.com.kz', '/admin/fortune/redeem', {
                    'code': code,
                  }).toString(),
                  size: 184,
                  padding: const EdgeInsets.all(16),
                  backgroundColor: Colors.white,
                ),
              ),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: SelectableText(
                    code,
                    style: TextStyle(color: colors.mutedText, fontSize: 12),
                  ),
                ),
                TextButton(
                  onPressed: () => Clipboard.setData(ClipboardData(text: code)),
                  child: Text(fortuneText('copy')),
                ),
              ],
            ),
          ],
          if (active && bonus) ...[
            const SizedBox(height: 18),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: redeeming ? null : onRedeem,
                child: redeeming
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : Text(
                        fortuneText('redeem').replaceAll(
                          '{amount}',
                          formatMoney(_number(prize['bonusAmount'])),
                        ),
                      ),
              ),
            ),
          ],
          if (!redeemed && expiry != null) ...[
            const SizedBox(height: 12),
            Text(
              '${fortuneText('expiry')} ${formatUiDate(context, expiry)}',
              style: TextStyle(color: colors.mutedText, fontSize: 13),
            ),
          ],
          if (_string(prize['branchName']).isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(
              _string(prize['branchName']),
              style: TextStyle(color: colors.mutedText, fontSize: 13),
            ),
          ],
        ],
      ),
    );
  }
}

String _string(Object? value) => value?.toString() ?? '';
double _number(Object? value) =>
    value is num ? value.toDouble() : double.tryParse(_string(value)) ?? 0;
