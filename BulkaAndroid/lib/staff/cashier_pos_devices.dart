part of '../main.dart';

class CashierPosDevicesScreen extends StatefulWidget {
  const CashierPosDevicesScreen({
    required this.api,
    required this.branchName,
    super.key,
  });
  final StaffApiClient api;
  final String branchName;
  @override
  State<CashierPosDevicesScreen> createState() =>
      _CashierPosDevicesScreenState();
}

class _CashierPosDevicesScreenState extends State<CashierPosDevicesScreen>
    with WidgetsBindingObserver {
  List<Map<String, dynamic>> _devices = [];
  String? _pairingId;
  String? _code;
  DateTime? _expiresAt;
  String? _error;
  String? _connectedName;
  bool _loading = true;
  bool _creating = false;
  bool _fetching = false;
  bool _active = true;
  int _ticks = 0;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(_refresh());
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!_active || !mounted) return;
      if (_code != null) setState(() {});
      if (++_ticks % (_code != null ? 5 : 15) == 0) unawaited(_refresh());
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _active = state == AppLifecycleState.resumed;
    if (_active) unawaited(_refresh());
  }

  Future<void> _refresh() async {
    if (_fetching) return;
    _fetching = true;
    try {
      final requestedPairing = _pairingId;
      final result = await widget.api.request(
        '/staff/pos/devices',
        query: {'pairingId': ?requestedPairing},
      );
      final devices = (result['devices'] as List? ?? [])
          .map((row) => Map<String, dynamic>.from(row as Map))
          .toList();
      if (!mounted) return;
      setState(() {
        _devices = devices;
        _loading = false;
        _error = null;
        final pairing = result['pairing'];
        if (_code != null &&
            requestedPairing == _pairingId &&
            pairing is Map &&
            pairing['id'] == _pairingId) {
          if (pairing['status'] == 'paired') {
            final linked = devices
                .where((row) => row['terminalId'] == pairing['terminalId'])
                .firstOrNull;
            _connectedName =
                '${linked?['name'] ?? staffText('Касса', 'Касса', 'Register')}';
            _code = null;
            _expiresAt = null;
            _pairingId = null;
          } else if (pairing['status'] == 'expired') {
            _expiresAt = DateTime.now();
          }
        }
      });
    } catch (error) {
      if (mounted) {
        setState(() {
          _error = '$error';
          _loading = false;
        });
      }
    } finally {
      _fetching = false;
    }
  }

  Future<void> _createCode() async {
    if (_creating) return;
    setState(() {
      _creating = true;
      _error = null;
      _connectedName = null;
      _code = null;
      _pairingId = null;
    });
    try {
      final result = await widget.api.request(
        '/staff/pos/pairing-code',
        method: 'POST',
        body: <String, dynamic>{},
      );
      if (!mounted) return;
      setState(() {
        _code = '${result['code']}';
        _expiresAt = DateTime.parse('${result['expiresAt']}');
        _pairingId = '${result['pairingId']}';
      });
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _creating = false);
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final left = (_expiresAt?.difference(DateTime.now()).inSeconds ?? 0).clamp(
      0,
      300,
    );
    final title = staffText(
      'Кассы филиала',
      'Филиал кассалары',
      'Branch registers',
    );
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(title: Text(title)),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(20),
          children: [
            Text(
              widget.branchName,
              style: Theme.of(
                context,
              ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 8),
            Text(
              staffText(
                'Общие заказы и остатки на iPad и кассах филиала.',
                'iPad пен филиал кассаларындағы ортақ тапсырыстар мен қалдықтар.',
                'Shared orders and stock on the iPad and branch registers.',
              ),
              style: const TextStyle(color: Color(0xff77716c), height: 1.5),
            ),
            const SizedBox(height: 24),
            if (_loading)
              const Center(child: CircularProgressIndicator())
            else if (_devices.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 24),
                child: Column(
                  children: [
                    const Icon(
                      Icons.point_of_sale_outlined,
                      size: 40,
                      color: Color(0xff9b8c80),
                    ),
                    const SizedBox(height: 12),
                    Text(
                      staffText(
                        'Кассы пока не привязаны',
                        'Кассалар әлі байланыстырылмаған',
                        'No registers linked yet',
                      ),
                    ),
                  ],
                ),
              )
            else
              ..._devices.map((device) {
                final online = device['online'] == true;
                return Container(
                  margin: const EdgeInsets.only(bottom: 12),
                  decoration: BoxDecoration(
                    border: Border.all(color: const Color(0xffece8e3)),
                    borderRadius: BorderRadius.circular(16),
                  ),
                  child: ListTile(
                    contentPadding: const EdgeInsets.symmetric(
                      horizontal: 16,
                      vertical: 8,
                    ),
                    leading: const Icon(Icons.point_of_sale_outlined),
                    title: Text(
                      '${device['name']}',
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontWeight: FontWeight.w600),
                    ),
                    subtitle: Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: Text(
                        online
                            ? staffText('На связи', 'Байланыста', 'Online')
                            : staffText('Нет связи', 'Байланыс жоқ', 'Offline'),
                        style: TextStyle(
                          color: online
                              ? const Color(0xff218659)
                              : const Color(0xff827970),
                        ),
                      ),
                    ),
                    trailing: Icon(
                      Icons.circle,
                      size: 10,
                      color: online
                          ? const Color(0xff218659)
                          : const Color(0xffb4ada6),
                    ),
                  ),
                );
              }),
            if (_connectedName != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 16),
                child: Text(
                  staffText(
                    'Касса «$_connectedName» привязана',
                    '«$_connectedName» кассасы байланыстырылды',
                    'Register “$_connectedName” linked',
                  ),
                  style: const TextStyle(color: Color(0xff218659)),
                ),
              ),
            if (_code != null)
              Container(
                key: const ValueKey('pos-pairing-code'),
                padding: const EdgeInsets.all(20),
                margin: const EdgeInsets.symmetric(vertical: 12),
                decoration: BoxDecoration(
                  color: const Color(0xfffff8e8),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Column(
                  children: [
                    Text(
                      staffText(
                        'Код для одной кассы',
                        'Бір кассаға арналған код',
                        'Code for one register',
                      ),
                    ),
                    const SizedBox(height: 16),
                    if (left > 0)
                      FittedBox(
                        child: Text(
                          _code!,
                          semanticsLabel: _code!.split('').join(' '),
                          style: const TextStyle(
                            fontSize: 40,
                            fontWeight: FontWeight.w700,
                            letterSpacing: 8,
                          ),
                        ),
                      )
                    else
                      Text(
                        staffText(
                          'Код истёк',
                          'Код мерзімі аяқталды',
                          'Code expired',
                        ),
                        style: const TextStyle(fontWeight: FontWeight.w700),
                      ),
                    const SizedBox(height: 12),
                    Text(
                      left > 0
                          ? '${left ~/ 60}:${(left % 60).toString().padLeft(2, '0')}'
                          : staffText(
                              'Получите новый код ниже',
                              'Төменде жаңа код алыңыз',
                              'Get a new code below',
                            ),
                    ),
                    const SizedBox(height: 16),
                    Text(
                      staffText(
                        'В iikoFront откройте меню Bulka → «Привязать кассу» и введите код.',
                        'iikoFront ішінде Bulka → «Привязать кассу» мәзірін ашып, кодты енгізіңіз.',
                        'In iikoFront, open Bulka → “Привязать кассу” and enter this code.',
                      ),
                      textAlign: TextAlign.center,
                      style: const TextStyle(height: 1.5),
                    ),
                  ],
                ),
              ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 12),
                child: Text(
                  _error!,
                  style: const TextStyle(color: Color(0xffb3261e)),
                ),
              ),
            const SizedBox(height: 8),
            FilledButton.icon(
              key: const ValueKey('pos-create-code'),
              style: FilledButton.styleFrom(
                minimumSize: const Size.fromHeight(52),
                backgroundColor: const Color(0xff66381f),
                foregroundColor: Colors.white,
              ),
              onPressed: _creating || _loading ? null : _createCode,
              icon: _creating
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.add_rounded),
              label: Text(
                _code != null
                    ? staffText(
                        'Получить новый код',
                        'Жаңа код алу',
                        'Get a new code',
                      )
                    : staffText(
                        'Привязать кассу',
                        'Кассаны байланыстыру',
                        'Link a register',
                      ),
              ),
            ),
            const SizedBox(height: 12),
            Text(
              staffText(
                'Для второй кассы получите отдельный код.',
                'Екінші касса үшін жеке код алыңыз.',
                'Get a separate code for the second register.',
              ),
              textAlign: TextAlign.center,
              style: const TextStyle(color: Color(0xff77716c), fontSize: 12),
            ),
          ],
        ),
      ),
    );
  }
}
