part of '../main.dart';

String _accountText(String key) {
  const labels = {
    'deliveryAsap': [
      'Доставим как можно скорее. Заказ поступит на кухню после оплаты.',
      'Мүмкіндігінше тез жеткіземіз. Төлемнен кейін тапсырыс асүйге түседі.',
      'Delivery as soon as possible. Your order reaches the kitchen after payment.',
    ],
    'title': ['Личный счёт', 'Жеке шот', 'Personal account'],
    'hint': [
      'Пополните банковской картой и оплачивайте заказы с баланса. Привязка карты не нужна.',
      'Банк картасымен толтырып, тапсырысты теңгерімнен төлеңіз. Картаны байланыстыру қажет емес.',
      'Top up by bank card and pay for orders from your balance. No saved card required.',
    ],
    'topup': ['Пополнить счёт', 'Шотты толтыру', 'Top up'],
    'amount': [
      'Сумма, ₸ (100–200 000)',
      'Сома, ₸ (100–200 000)',
      'Amount, ₸ (100–200,000)',
    ],
    'invalid': [
      'Введите целую сумму от 100 до 200 000 ₸',
      '100-ден 200 000 ₸-ге дейінгі бүтін соманы енгізіңіз',
      'Enter a whole amount from 100 to 200,000 ₸',
    ],
    'blocked': [
      'Операции приостановлены. Обратитесь в поддержку.',
      'Операциялар тоқтатылды. Қолдау қызметіне хабарласыңыз.',
      'Transactions are paused. Contact support.',
    ],
    'unavailable': [
      'Личный счёт временно недоступен',
      'Жеке шот уақытша қолжетімсіз',
      'Personal account is temporarily unavailable',
    ],
    'history': [
      'История операций',
      'Операциялар тарихы',
      'Transaction history',
    ],
    'empty': [
      'Операций пока нет',
      'Әзірге операциялар жоқ',
      'No transactions yet',
    ],
    'refresh': ['Обновить', 'Жаңарту', 'Refresh'],
    'pending': [
      'Проверяем пополнение. Деньги появятся после подтверждения банка.',
      'Толықтыру тексерілуде. Ақша банк растағаннан кейін түседі.',
      'Checking the top-up. Funds appear after bank confirmation.',
    ],
    'continue': [
      'Продолжить пополнение',
      'Толықтыруды жалғастыру',
      'Continue top-up',
    ],
    'credited': [
      'Деньги зачислены на личный счёт',
      'Ақша жеке шотқа түсті',
      'Funds credited to your personal account',
    ],
    'payment': ['Оплата заказа', 'Тапсырысты төлеу', 'Order payment'],
    'refund': ['Возврат за заказ', 'Тапсырыс үшін қайтару', 'Order refund'],
    'reversal': [
      'Отмена пополнения банком',
      'Банк толықтыруды қайтарды',
      'Top-up reversed by bank',
    ],
    'balance': ['Баланс', 'Теңгерім', 'Balance'],
  };
  return labels[key]?[AppLang.current == 'kk'
          ? 1
          : AppLang.current == 'en'
          ? 2
          : 0] ??
      key;
}

class PersonalAccountOption extends StatefulWidget {
  const PersonalAccountOption({
    required this.api,
    required this.selected,
    required this.onAvailable,
    required this.onSelect,
    super.key,
  });
  final BulkaApiClient api;
  final bool selected;
  final ValueChanged<bool> onAvailable;
  final VoidCallback onSelect;
  @override
  State<PersonalAccountOption> createState() => _PersonalAccountOptionState();
}

class _PersonalAccountOptionState extends State<PersonalAccountOption> {
  Map<String, dynamic>? _account;
  StreamSubscription<dynamic>? _events;
  @override
  void initState() {
    super.initState();
    unawaited(_load());
    _events = widget.api.customerEvents.listen((event) {
      if (event['type'] == 'personal-account.updated') unawaited(_load());
    });
  }

  bool _loading = false;
  Future<void> _load() async {
    if (_loading) return;
    _loading = true;
    final session = widget.api.sessionCacheScope;
    try {
      final account = await widget.api.getPersonalAccount();
      if (!mounted || session != widget.api.sessionCacheScope) return;
      setState(() => _account = account);
      widget.onAvailable(
        account['enabled'] == true && account['blocked'] != true,
      );
    } catch (_) {
      if (mounted) {
        setState(() => _account = null);
        widget.onAvailable(false);
      }
    } finally {
      _loading = false;
    }
  }

  @override
  void dispose() {
    _events?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final account = _account;
    if (account == null || account['enabled'] != true) {
      return const SizedBox.shrink();
    }
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      elevation: 0,
      color: context.bulkaColors.surfaceCream,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(BulkaRadii.control),
      ),
      child: ListTile(
        key: const ValueKey('checkout-personal-account'),
        dense: true,
        contentPadding: const EdgeInsets.fromLTRB(14, 6, 6, 6),
        leading: Icon(
          widget.selected ? Icons.radio_button_checked : Icons.radio_button_off,
          color: context.bulkaColors.brandBrown,
          size: 22,
        ),
        title: Text(
          _accountText('title'),
          style: const TextStyle(fontWeight: FontWeight.w600),
        ),
        subtitle: Text(
          account['blocked'] == true
              ? _accountText('blocked')
              : '${_accountText('balance')}: ${_asDouble(account['balance']).toStringAsFixed(2)} ₸',
        ),
        trailing: IconButton(
          key: const ValueKey('checkout-personal-account-topup'),
          tooltip: _accountText('topup'),
          onPressed: () async {
            await Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => PersonalAccountScreen(
                  api: widget.api,
                  initialBalance: _asDouble(account['balance']),
                ),
              ),
            );
            await _load();
          },
          icon: const Icon(Icons.add_circle_outline_rounded),
          color: context.bulkaColors.brandBrown,
        ),
        onTap: account['blocked'] == true ? null : widget.onSelect,
      ),
    );
  }
}

class PersonalAccountScreen extends StatefulWidget {
  const PersonalAccountScreen({
    required this.api,
    this.initialTopupId,
    this.initialBalance,
    super.key,
  });
  final BulkaApiClient api;
  final String? initialTopupId;
  final double? initialBalance;
  @override
  State<PersonalAccountScreen> createState() => _PersonalAccountScreenState();
}

class _PersonalAccountScreenState extends State<PersonalAccountScreen> {
  final _amount = TextEditingController(text: '1000');
  Map<String, dynamic>? _account;
  String? _error;
  String? _requestId;
  String? _topupId;
  double? _cachedBalance;
  bool _busy = false;
  bool _refreshing = false;
  Timer? _timer;
  late final String? _session;
  String get _key => customerPreferenceKey('personal_account_topup', _session);
  @override
  void initState() {
    super.initState();
    _session = widget.api.sessionCacheScope;
    _cachedBalance = widget.initialBalance;
    unawaited(_restore());
    _timer = Timer.periodic(const Duration(seconds: 5), (_) {
      if (!_busy) unawaited(_refresh());
    });
  }

  Future<void> _restore() async {
    final prefs = await SharedPreferences.getInstance();
    if (!mounted || _session != widget.api.sessionCacheScope) return;
    final balance = prefs.getDouble(
      customerPreferenceKey('personal_account_balance', _session),
    );
    if (balance != null && mounted) setState(() => _cachedBalance = balance);
    try {
      final raw = prefs.getString(_key);
      final saved = raw == null
          ? <String, dynamic>{}
          : jsonDecode(raw) as Map<String, dynamic>;
      _requestId = saved['requestId'] as String?;
      _topupId = widget.initialTopupId ?? saved['topupId'] as String?;
      if (saved['amount'] != null) _amount.text = saved['amount'].toString();
    } catch (_) {
      _topupId = widget.initialTopupId;
    }
    await _refresh();
  }

  Future<void> _persist() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
      _key,
      jsonEncode({
        'requestId': _requestId,
        'topupId': _topupId,
        'amount': int.tryParse(_amount.text),
      }),
    );
  }

  Future<void> _refresh() async {
    if (_refreshing || !mounted || _session != widget.api.sessionCacheScope) {
      return;
    }
    _refreshing = true;
    try {
      String? statusError;
      if (_topupId != null) {
        try {
          final status = await widget.api.checkPersonalAccountTopup(_topupId!);
          if (!mounted || _session != widget.api.sessionCacheScope) return;
          if (status['paymentStatus'] == 'paid' ||
              isTerminalForteFailure(_asString(status['paymentStatus']))) {
            _topupId = null;
            _requestId = null;
            await (await SharedPreferences.getInstance()).remove(_key);
          }
        } catch (e) {
          statusError = localizeErrorMessage(e);
        }
      }
      final account = await widget.api.getPersonalAccount();
      if (mounted && _session == widget.api.sessionCacheScope) {
        final balance = _asDouble(account['balance']);
        await (await SharedPreferences.getInstance()).setDouble(
          customerPreferenceKey('personal_account_balance', _session),
          balance,
        );
        if (!mounted || _session != widget.api.sessionCacheScope) return;
        setState(() {
          _account = account;
          _cachedBalance = balance;
          _error = statusError;
        });
      }
    } catch (e) {
      if (mounted && _session == widget.api.sessionCacheScope) {
        setState(() => _error = localizeErrorMessage(e));
      }
    } finally {
      _refreshing = false;
    }
  }

  Future<void> _topUp() async {
    if (_busy || _session != widget.api.sessionCacheScope) return;
    final amount = int.tryParse(_amount.text.trim());
    if (amount == null || amount < 100 || amount > 200000) {
      setState(() => _error = _accountText('invalid'));
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      _requestId ??= _newCheckoutId();
      await _persist();
      final result = await widget.api.createPersonalAccountTopup(
        _requestId!,
        amount,
      );
      if (!mounted || _session != widget.api.sessionCacheScope) return;
      _topupId = _asString(result['operationId']);
      await _persist();
      if (!mounted) return;
      final url = _asString(result['redirectUrl']);
      if (url.isNotEmpty) {
        await Navigator.of(context).push<FortePaymentResult>(
          MaterialPageRoute(
            builder: (_) => FortePaymentScreen(
              api: widget.api,
              operationId: _topupId!,
              redirectUrl: url,
              personalAccountTopup: true,
            ),
          ),
        );
      }
      await _refresh();
    } catch (e) {
      if (mounted) setState(() => _error = localizeErrorMessage(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    _amount.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final account = _account;
    final enabled = account?['enabled'] == true && account?['blocked'] != true;
    final entries = (account?['entries'] as List?) ?? [];
    return Scaffold(
      appBar: AppBar(title: Text(_accountText('title'))),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: ListView(
          padding: const EdgeInsets.all(24),
          children: [
            AnimatedSwitcher(
              duration: const Duration(milliseconds: 180),
              child: account != null || _cachedBalance != null
                  ? Align(
                      key: const ValueKey('personal-account-balance'),
                      alignment: Alignment.centerLeft,
                      child: Text(
                        '${(_cachedBalance ?? _asDouble(account?['balance'])).toStringAsFixed(2)} ₸',
                        style: const TextStyle(
                          fontSize: 34,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    )
                  : const Align(
                      key: ValueKey('personal-account-balance-loading'),
                      alignment: Alignment.centerLeft,
                      child: SizedBox.square(
                        dimension: 32,
                        child: CircularProgressIndicator(strokeWidth: 3),
                      ),
                    ),
            ),
            const SizedBox(height: 12),
            Text(_accountText('hint')),
            const SizedBox(height: 24),
            if (account?['blocked'] == true) Text(_accountText('blocked')),
            if (account != null && account['enabled'] != true)
              Text(_accountText('unavailable')),
            TextField(
              key: const ValueKey('personal-account-topup-amount'),
              controller: _amount,
              enabled: enabled && !_busy && _requestId == null,
              keyboardType: TextInputType.number,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              decoration: InputDecoration(labelText: _accountText('amount')),
            ),
            const SizedBox(height: 12),
            FilledButton(
              key: const ValueKey('personal-account-topup'),
              onPressed: enabled && !_busy ? _topUp : null,
              child: Text(
                _requestId == null
                    ? _accountText('topup')
                    : _accountText('continue'),
              ),
            ),
            if (_topupId != null)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 12),
                child: Text(_accountText('pending')),
              ),
            if (_error != null)
              Text(
                _error!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            TextButton(
              onPressed: _refresh,
              child: Text(_accountText('refresh')),
            ),
            const SizedBox(height: 24),
            Text(
              _accountText('history'),
              style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 20),
            ),
            if (entries.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 16),
                child: Text(_accountText('empty')),
              ),
            for (final entry in entries.whereType<Map>())
              ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(_accountText(_asString(entry['kind']))),
                subtitle: Text(
                  (DateTime.tryParse(
                            _asString(entry['createdAt']),
                          )?.toLocal().toString() ??
                          '')
                      .split('.')
                      .first,
                ),
                trailing: Text(
                  '${_asDouble(entry['amount']) > 0 ? '+' : ''}${_asDouble(entry['amount']).toStringAsFixed(2)} ₸',
                ),
              ),
          ],
        ),
      ),
    );
  }
}
