part of '../main.dart';

class ReferralScreen extends StatefulWidget {
  const ReferralScreen({required this.api, super.key});
  final BulkaApiClient api;
  @override
  State<ReferralScreen> createState() => _ReferralScreenState();
}

class _ReferralScreenState extends State<ReferralScreen> {
  late Future<Map<String, dynamic>> _referral;
  @override
  void initState() {
    super.initState();
    _referral = widget.api.getReferral();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text('rewards_invite_friend'.tr)),
    body: FutureBuilder<Map<String, dynamic>>(
      future: _referral,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return const Center(child: CircularProgressIndicator());
        }
        if (snapshot.hasError || snapshot.data == null) {
          return Center(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text('referral_load_error'.tr, textAlign: TextAlign.center),
                  const SizedBox(height: 16),
                  FilledButton(
                    onPressed: () {
                      final request = widget.api.getReferral();
                      setState(() {
                        _referral = request;
                      });
                    },
                    child: Text('referral_retry'.tr),
                  ),
                ],
              ),
            ),
          );
        }
        final referral = snapshot.data!;
        final url = _asString(referral['url']);
        final enabled = referral['enabled'] == true && url.isNotEmpty;
        return ListView(
          padding: const EdgeInsets.all(24),
          children: [
            Text(
              enabled
                  ? 'rewards_invite_description'.trArgs({
                      'owner':
                          '${formatMoney(_asDouble(referral['reward_referrer']))} ₸',
                      'friend':
                          '${formatMoney(_asDouble(referral['reward_friend']))} ₸',
                      'minimum':
                          '${formatMoney(_asDouble(referral['min_first_order']))} ₸',
                    })
                  : 'referral_disabled'.tr,
            ),
            const SizedBox(height: 24),
            SelectableText(
              _asString(referral['code']),
              style: Theme.of(context).textTheme.titleLarge,
            ),
            const SizedBox(height: 24),
            _ReferralShareButton(url: enabled ? url : ''),
            const SizedBox(height: 12),
            OutlinedButton(
              onPressed: !enabled
                  ? null
                  : () async {
                      await Clipboard.setData(ClipboardData(text: url));
                      if (context.mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          bulkaSnackBar(
                            content: Text('referral_link_copied'.tr),
                          ),
                        );
                      }
                    },
              child: Text('rewards_copy'.tr),
            ),
            const SizedBox(height: 32),
            _ReferralHistory(api: widget.api),
          ],
        );
      },
    ),
  );
}

class _ReferralHistory extends StatefulWidget {
  const _ReferralHistory({required this.api});
  final BulkaApiClient api;
  @override
  State<_ReferralHistory> createState() => _ReferralHistoryState();
}

class _ReferralHistoryState extends State<_ReferralHistory> {
  Map<String, dynamic>? _history;
  final List<Map<String, dynamic>> _items = [];
  bool _loading = false;
  bool _failed = false;
  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load({bool refresh = false}) async {
    if (_loading) return;
    setState(() {
      _loading = true;
      _failed = false;
    });
    try {
      final data = await widget.api.getReferralHistory(
        offset: refresh ? 0 : _items.length,
      );
      if (!mounted) return;
      setState(() {
        _history = data;
        if (refresh) _items.clear();
        _items.addAll(
          (data['items'] is List ? data['items'] as List : []).map(_asMap),
        );
      });
    } catch (_) {
      if (mounted) {
        setState(() {
          _failed = true;
        });
      }
    } finally {
      if (mounted) {
        setState(() {
          _loading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      Text(
        'referral_history'.tr,
        style: Theme.of(context).textTheme.titleLarge,
      ),
      const SizedBox(height: 12),
      if (_history != null) ...[
        Text(
          'referral_summary'.trArgs({
            'registered': '${_history!['registered'] ?? 0}',
            'purchased': '${_history!['purchased'] ?? 0}',
            'earned': formatMoney(_asDouble(_history!['earned'])),
            'reversed': formatMoney(_asDouble(_history!['reversed'])),
          }),
        ),
        if (_asDouble(_history!['debt']) > 0)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 12),
            child: Text(
              'referral_debt'.trArgs({
                'amount': formatMoney(_asDouble(_history!['debt'])),
              }),
            ),
          ),
        if (_items.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 16),
            child: Text('referral_empty'.tr),
          ),
        ..._items.map(
          (item) => Padding(
            padding: const EdgeInsets.symmetric(vertical: 12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'referral_friend_number'.trArgs({
                    'number': '${item['number']}',
                  }),
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                Text('referral_status_${_asString(item['status'])}'.tr),
                if (item['purchased'] == true) Text('referral_purchased'.tr),
                if (_asDouble(item['reward']) > 0)
                  Text(
                    'referral_your_reward'.trArgs({
                      'amount': formatMoney(_asDouble(item['reward'])),
                    }),
                  ),
              ],
            ),
          ),
        ),
      ],
      if (_failed) ...[
        Text('referral_load_error'.tr),
        TextButton(
          onPressed: _loading ? null : () => _load(),
          child: Text('referral_retry'.tr),
        ),
      ],
      if (_loading) const Center(child: CircularProgressIndicator()),
      if (!_loading && !_failed && _history != null)
        TextButton(
          onPressed: () => _load(
            refresh: _items.length >= _asDouble(_history!['registered']),
          ),
          child: Text(
            (_items.length < _asDouble(_history!['registered'])
                    ? 'referral_more'
                    : 'referral_refresh')
                .tr,
          ),
        ),
    ],
  );
}

class _ReferralRegistrationField extends StatefulWidget {
  const _ReferralRegistrationField();
  @override
  State<_ReferralRegistrationField> createState() =>
      _ReferralRegistrationFieldState();
}

class _ReferralRegistrationFieldState
    extends State<_ReferralRegistrationField> {
  final _controller = TextEditingController();
  bool _edited = false;
  @override
  void initState() {
    super.initState();
    PendingReferral.read().then((code) {
      if (mounted && !_edited) _controller.text = code ?? '';
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => TextField(
    controller: _controller,
    textCapitalization: TextCapitalization.characters,
    autocorrect: false,
    maxLength: 14,
    decoration: InputDecoration(
      labelText: 'referral_registration_label'.tr,
      helperText: 'referral_registration_hint'.tr,
      helperMaxLines: 3,
      counterText: '',
    ),
    onChanged: (value) {
      _edited = true;
      unawaited(PendingReferral.set(value));
    },
  );
}

class _ReferralShareButton extends StatelessWidget {
  const _ReferralShareButton({required this.url});
  final String url;
  @override
  Widget build(BuildContext context) => FilledButton(
    onPressed: url.isEmpty
        ? null
        : () async {
            final box = context.findRenderObject() as RenderBox?;
            try {
              await SharePlus.instance.share(
                ShareParams(
                  text: '${'referral_share_message'.tr}\n$url',
                  sharePositionOrigin: box == null
                      ? null
                      : box.localToGlobal(Offset.zero) & box.size,
                ),
              );
            } catch (_) {
              if (context.mounted) {
                ScaffoldMessenger.of(context).showSnackBar(
                  bulkaSnackBar(content: Text('referral_share_error'.tr)),
                );
              }
            }
          },
    child: Text('referral_share_link'.tr),
  );
}
