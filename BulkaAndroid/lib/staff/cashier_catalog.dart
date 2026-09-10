part of '../main.dart';

Future<bool> confirmCashierStockChange(
  BuildContext context,
  Map<String, dynamic> product,
  Map<String, dynamic> changes,
) async {
  FocusScope.of(context).unfocus();
  final detail = changes['useIiko'] == true
      ? '${staffText('Остаток iikoFront', 'iikoFront қалдығы', 'iikoFront stock')}: ${product['frontQuantity'] ?? staffText('не ограничен', 'шектеусіз', 'unlimited')}'
      : changes.containsKey('sourceQuantity')
      ? '${staffText('Остаток', 'Қалдық', 'Stock')}: ${product['sourceQuantity'] ?? '—'} → ${changes['sourceQuantity']}'
      : changes['manualStop'] == true || changes['preorderStop'] == true
      ? staffText(
          'Добавить в стоп-лист',
          'Стоп-тізімге қосу',
          'Add to stop list',
        )
      : staffText(
          'Снять со стоп-листа',
          'Стоп-тізімнен алу',
          'Remove from stop list',
        );
  return await showDialog<bool>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          backgroundColor: Colors.white,
          title: Text(
            staffText(
              'Сохранить изменения?',
              'Өзгерістер сақталсын ба?',
              'Save changes?',
            ),
          ),
          content: Text('${product['name']}\n\n$detail'),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: Text(staffText('Отмена', 'Бас тарту', 'Cancel')),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(dialogContext, true),
              child: Text(staffText('Сохранить', 'Сақтау', 'Save')),
            ),
          ],
        ),
      ) ??
      false;
}

class CashierCatalog extends StatefulWidget {
  const CashierCatalog({
    required this.api,
    this.pendingPreorders = 0,
    super.key,
  });
  final StaffApiClient api;
  final int pendingPreorders;
  @override
  State<CashierCatalog> createState() => _CashierCatalogState();
}

class _CashierCatalogState extends State<CashierCatalog> {
  late final StaffLiveRefresh _live;
  List<Map<String, dynamic>> _products = [];
  Map<String, dynamic> _frontSync = {};
  bool _loading = true, _running = false, _pending = false;
  String? _error;
  String _search = '', _filter = 'all', _category = '__all__';
  final _searchController = TextEditingController();
  final _scroll = ScrollController();
  final Set<String> _saving = {};
  bool _preorders = false;
  @override
  void initState() {
    super.initState();
    unawaited(_load());
    _live = StaffLiveRefresh(
      widget.api,
      _load,
      events: ['inventory.updated', 'order.updated', 'order.created'],
    );
  }

  Future<void> _load() async {
    _pending = true;
    if (_running) return;
    _running = true;
    try {
      while (_pending && mounted) {
        _pending = false;
        try {
          final requestedPreorders = _preorders;
          final result = await widget.api.request(
            '/staff/catalog${requestedPreorders ? '?scope=preorder' : ''}',
          );
          if (mounted) {
            if (requestedPreorders != _preorders) {
              _pending = true;
              continue;
            }
            setState(() {
              _products = staffRows(result['products']);
              _frontSync = result['frontSync'] is Map
                  ? Map<String, dynamic>.from(result['frontSync'] as Map)
                  : {};
              _error = null;
            });
          }
        } catch (error) {
          if (mounted) setState(() => _error = '$error');
        } finally {
          if (mounted) setState(() => _loading = false);
        }
      }
    } finally {
      _running = false;
    }
  }

  bool _stopped(Map<String, dynamic> p) =>
      p['manualStop'] == true ||
      p['blockedBy'] != null ||
      p['availableQuantity'] == 0;
  Future<void> _save(
    Map<String, dynamic> product,
    Map<String, dynamic> changes,
  ) async {
    await widget.api.request(
      '/staff/catalog/${Uri.encodeComponent('${product['id']}')}',
      method: 'PATCH',
      body: {'expectedRevision': product['revision'] ?? 0, ...changes},
    );
    await _load();
  }

  Future<void> _stop(Map<String, dynamic> product, bool stopped) async {
    final id = '${product['id']}';
    if (_saving.contains(id)) return;
    setState(() => _saving.add(id));
    try {
      final changes = {
        product['preorder'] == true ? 'preorderStop' : 'manualStop': stopped,
      };
      if (!await confirmCashierStockChange(context, product, changes) ||
          !mounted) {
        return;
      }
      await _save(product, changes);
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('$error')));
      }
      await _load();
    } finally {
      if (mounted) setState(() => _saving.remove(id));
    }
  }

  Future<void> _edit(Map<String, dynamic> product) async {
    if (product['preorder'] == true) return;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      showDragHandle: true,
      useSafeArea: true,
      builder: (_) => _CashierQuantitySheet(
        product: product,
        save: (quantity) => _save(product, {'sourceQuantity': quantity}),
        useIiko:
            product['stockSource'] == 'manual' &&
                product['isIikoProduct'] == true &&
                _frontSync['connected'] == true
            ? () => _save(product, {'useIiko': true})
            : null,
      ),
    );
    await _load();
  }

  void _filterChanged(VoidCallback change) {
    setState(change);
    if (_scroll.hasClients) _scroll.jumpTo(0);
  }

  void _selectScope(bool preorders) {
    if (_preorders == preorders) return;
    _filterChanged(() {
      _preorders = preorders;
      _filter = 'all';
      _products = [];
      _loading = true;
    });
    unawaited(_load());
  }

  Future<void> _useTablet() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(
          staffText(
            'Управлять с планшета?',
            'Планшеттен басқару керек пе?',
            'Manage from the tablet?',
          ),
        ),
        content: Text(
          staffText(
            'Кассы временно не смогут начинать новые продажи. Оплаченные заказы и резервы сохранятся. Для возврата управления выполните сверку витрины на главной кассе.',
            'Кассалар жаңа сатылымдарды уақытша бастай алмайды. Төленген тапсырыстар мен резервтер сақталады. Басқаруды қайтару үшін негізгі кассада қалдықты салыстырыңыз.',
            'Registers will temporarily stop starting new sales. Paid orders and reservations stay protected. Reconcile stock on the main register to return control.',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(staffText('Отмена', 'Бас тарту', 'Cancel')),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(staffText('Переключить', 'Ауыстыру', 'Switch')),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await widget.api.request(
        '/staff/catalog/fallback',
        method: 'POST',
        body: {'requestId': _newCheckoutId(), 'confirmed': true},
      );
      await _load();
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    }
  }

  @override
  Widget build(BuildContext context) {
    final categories =
        _products.map((p) => '${p['category'] ?? ''}').toSet().toList()..sort();
    final categoryOptions = {
      '__all__': staffText(
        'Все категории',
        'Барлық санаттар',
        'All categories',
      ),
      for (final category in categories)
        category: category.isEmpty
            ? staffText('Без категории', 'Санатсыз', 'Uncategorized')
            : category,
    };
    final selectedCategory = categoryOptions.containsKey(_category)
        ? _category
        : '__all__';
    final visible =
        _products
            .where(
              (p) =>
                  '${p['name']} ${p['category']}'.toLowerCase().contains(
                    _search.toLowerCase(),
                  ) &&
                  (selectedCategory == '__all__' ||
                      '${p['category'] ?? ''}' == selectedCategory) &&
                  (_filter == 'all' ||
                      (_filter == 'stopped'
                          ? _stopped(p)
                          : p['sourceQuantity'] == null)),
            )
            .toList()
          ..sort((a, b) => '${a['name']}'.compareTo('${b['name']}'));
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
          child: Column(
            children: [
              TextField(
                controller: _searchController,
                onTapOutside: (_) => FocusScope.of(context).unfocus(),
                decoration: InputDecoration(
                  prefixIcon: const Icon(Icons.search_rounded, size: 21),
                  hintText: staffText(
                    'Название товара',
                    'Тауар атауы',
                    'Product name',
                  ),
                  suffixIcon: _search.isEmpty
                      ? null
                      : IconButton(
                          tooltip: staffText(
                            'Очистить поиск',
                            'Іздеуді тазалау',
                            'Clear search',
                          ),
                          icon: const Icon(Icons.close_rounded, size: 18),
                          onPressed: () {
                            _searchController.clear();
                            _filterChanged(() => _search = '');
                          },
                        ),
                ),
                onChanged: (value) =>
                    _filterChanged(() => _search = value.trim()),
              ),
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () => _selectScope(false),
                      style: OutlinedButton.styleFrom(
                        backgroundColor: !_preorders
                            ? const Color(0xFFFFF3D4)
                            : Colors.white,
                      ),
                      child: Text(
                        staffText('Витрина', 'Сөре', 'Display stock'),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: () => _selectScope(true),
                      style: OutlinedButton.styleFrom(
                        backgroundColor: _preorders
                            ? const Color(0xFFFFF3D4)
                            : Colors.white,
                      ),
                      icon: Padding(
                        padding: EdgeInsets.only(
                          right: widget.pendingPreorders > 99 ? 16 : 0,
                        ),
                        child: StaffCountBadge(
                          key: const ValueKey('cashier-preorders-count'),
                          count: widget.pendingPreorders,
                          label: staffText(
                            'Непринятые предзаказы',
                            'Қабылданбаған алдын ала тапсырыстар',
                            'Unaccepted preorders',
                          ),
                          child: const Icon(
                            Icons.calendar_today_outlined,
                            size: 18,
                          ),
                        ),
                      ),
                      label: Text(
                        staffText(
                          'Предзаказы',
                          'Алдын ала тапсырыстар',
                          'Preorders',
                        ),
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              if (_preorders)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  child: Text(
                    staffText(
                      'Самовывоз минимум через 24 часа. Доступность по стоп-листу.',
                      'Кемінде 24 сағаттан кейін алып кету. Қолжетімділік стоп-тізім арқылы.',
                      'Pickup at least 24 hours ahead. Availability is controlled by the stop list.',
                    ),
                  ),
                ),
              if (!_preorders && _frontSync['guardEnabled'] == true)
                _frontSync['controlMode'] == 'tablet'
                    ? Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: Text(
                          staffText(
                            'Учёт с планшета. Кассовые продажи приостановлены.',
                            'Планшеттен есепке алу. Кассадағы сатылымдар тоқтатылды.',
                            'Tablet stock control. Register sales are paused.',
                          ),
                        ),
                      )
                    : OutlinedButton.icon(
                        onPressed: _useTablet,
                        icon: const Icon(
                          Icons.tablet_android_outlined,
                          size: 18,
                        ),
                        label: Text(
                          staffText(
                            'Управлять с планшета',
                            'Планшеттен басқару',
                            'Manage from tablet',
                          ),
                        ),
                      ),
              if (!_preorders && _frontSync['configured'] == true)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: Row(
                    children: [
                      Icon(
                        Icons.circle,
                        size: 7,
                        color: _frontSync['connected'] == true
                            ? const Color(0xFF34714F)
                            : const Color(0xFFA33C34),
                      ),
                      const SizedBox(width: 7),
                      Expanded(
                        child: Text(
                          _frontSync['controlMode'] == 'tablet'
                              ? staffText(
                                  'Резервы синхронизированы',
                                  'Резервтер синхрондалған',
                                  'Reservations synchronized',
                                )
                              : _frontSync['connected'] == true
                              ? staffText(
                                  'iikoFront подключён',
                                  'iikoFront қосылған',
                                  'iikoFront connected',
                                )
                              : staffText(
                                  'Касса не на связи. Доступно ручное управление.',
                                  'Касса байланыста емес. Қолмен өзгертуге болады.',
                                  'Register offline. Manual editing is available.',
                                ),
                          style: const TextStyle(fontSize: 11),
                        ),
                      ),
                    ],
                  ),
                ),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    flex: 3,
                    child: StaffPicker(
                      label: staffText('Категория', 'Санат', 'Category'),
                      value: selectedCategory,
                      options: categoryOptions,
                      onChanged: (value) =>
                          _filterChanged(() => _category = value),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    flex: 2,
                    child: StaffPicker(
                      label: staffText(
                        'Наличие',
                        'Қолжетімділік',
                        'Availability',
                      ),
                      value: _filter,
                      options: {
                        'all': staffText('Все', 'Барлығы', 'All'),
                        'stopped': staffText(
                          'Стоп-лист',
                          'Стоп-тізім',
                          'Stopped',
                        ),
                        if (!_preorders)
                          'untracked': staffText(
                            'Не указано',
                            'Көрсетілмеген',
                            'Not set',
                          ),
                      },
                      onChanged: (value) =>
                          _filterChanged(() => _filter = value),
                    ),
                  ),
                ],
              ),
              SizedBox(
                height: 48,
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        '${staffText('Найдено', 'Табылды', 'Found')}: ${visible.length}',
                        style: const TextStyle(
                          fontSize: 12,
                          color: Color(0xFF746B63),
                        ),
                      ),
                    ),
                    if (!_preorders)
                      SizedBox(
                        width: 68,
                        child: Text(
                          staffText('Остаток', 'Қалдық', 'Stock'),
                          textAlign: TextAlign.center,
                          style: const TextStyle(
                            fontSize: 11,
                            color: Color(0xFF746B63),
                          ),
                        ),
                      ),
                    SizedBox(
                      width: 52,
                      child: Text(
                        staffText('Стоп', 'Стоп', 'Stop'),
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          fontSize: 11,
                          color: Color(0xFF746B63),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        if (_loading) const LinearProgressIndicator(minHeight: 2),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: _StaffError(message: _error!, onRetry: _load),
          ),
        const Divider(height: 1),
        Expanded(
          child: RefreshIndicator(
            onRefresh: _load,
            child: ListView.builder(
              controller: _scroll,
              keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
              itemCount: visible.isEmpty ? 1 : visible.length,
              itemBuilder: (context, index) => visible.isEmpty
                  ? (_loading
                        ? const SizedBox.shrink()
                        : StaffEmptyState(
                            icon: Icons.search_off_rounded,
                            title: staffText(
                              'Товары не найдены',
                              'Тауарлар табылмады',
                              'No products found',
                            ),
                            description: staffText(
                              'Измените название или категорию.',
                              'Атауын немесе санатын өзгертіңіз.',
                              'Try another name or category.',
                            ),
                          ))
                  : _tile(visible[index]),
            ),
          ),
        ),
      ],
    );
  }

  Widget _tile(Map<String, dynamic> p) {
    final blocked = p['blockedBy'] != null,
        busy = _saving.contains('${p['id']}');
    final stopped = _stopped(p);
    final image = '${p['imageUrl'] ?? ''}';
    final status = p['blockedBy'] == 'iiko'
        ? staffText('Стоп iiko', 'iiko стоп', 'Stopped in iiko')
        : blocked
        ? staffText(
            'Отключён администратором',
            'Әкімші өшірген',
            'Disabled by administrator',
          )
        : p['manualStop'] == true
        ? staffText('В стоп-листе', 'Стоп-тізімде', 'In stop list')
        : p['preorder'] == true
        ? staffText('Доступно', 'Қолжетімді', 'Available')
        : p['availableQuantity'] == null
        ? staffText(
            'Остаток не указан',
            'Қалдық көрсетілмеген',
            'Quantity not set',
          )
        : '${staffText('Доступно', 'Қолжетімді', 'Available')}: ${p['availableQuantity']}';
    return Container(
      key: ValueKey('stock-${p['id']}'),
      padding: const EdgeInsets.symmetric(vertical: 12),
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(bottom: BorderSide(color: Color(0xFFECE6DF))),
      ),
      child: Row(
        children: [
          Container(
            width: 38,
            height: 42,
            decoration: BoxDecoration(
              border: Border.all(color: const Color(0xFFF0EAE3)),
              borderRadius: BorderRadius.circular(8),
            ),
            clipBehavior: Clip.antiAlias,
            child: image.isEmpty
                ? const Icon(
                    Icons.inventory_2_outlined,
                    size: 19,
                    color: Color(0xFF917D6B),
                  )
                : Image.network(
                    image,
                    fit: BoxFit.contain,
                    errorBuilder: (_, _, _) =>
                        const Icon(Icons.inventory_2_outlined, size: 19),
                  ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${p['name']}',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    height: 1.35,
                  ),
                ),
                const SizedBox(height: 5),
                Text(
                  status,
                  style: TextStyle(
                    fontSize: 11,
                    color: stopped
                        ? const Color(0xFFA33C34)
                        : const Color(0xFF34714F),
                  ),
                ),
                if ((p['reserved'] as num? ?? 0) > 0)
                  Text(
                    '${staffText('В заказах', 'Тапсырыстарда', 'Reserved')}: ${p['reserved']}',
                    style: const TextStyle(
                      fontSize: 10,
                      color: Color(0xFF746B63),
                    ),
                  ),
                if (p['preorder'] != true && p['stockSource'] == 'manual')
                  Text(
                    staffText('Вручную', 'Қолмен', 'Manual'),
                    style: const TextStyle(
                      fontSize: 10,
                      color: Color(0xFF746B63),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(width: 6),
          if (p['preorder'] != true)
            SizedBox(
              width: 62,
              child: Tooltip(
                message: staffText(
                  'Изменить остаток',
                  'Қалдықты өзгерту',
                  'Edit stock',
                ),
                child: OutlinedButton(
                  style: OutlinedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(horizontal: 4),
                    minimumSize: const Size(48, 44),
                  ),
                  onPressed: blocked || busy ? null : () => _edit(p),
                  child: Text(
                    p['sourceQuantity'] == null
                        ? '—'
                        : '${p['sourceQuantity']}',
                    style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ),
            ),
          const SizedBox(width: 6),
          SizedBox(
            width: 46,
            height: 48,
            child: FittedBox(
              child: Semantics(
                label:
                    '${staffText('Стоп-лист', 'Стоп-тізім', 'Stop list')}: ${p['name']}',
                child: Switch.adaptive(
                  value: p['manualStop'] == true,
                  onChanged: blocked || busy
                      ? null
                      : (value) => _stop(p, value),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  @override
  void dispose() {
    _live.dispose();
    _searchController.dispose();
    _scroll.dispose();
    super.dispose();
  }
}

class _CashierQuantitySheet extends StatefulWidget {
  const _CashierQuantitySheet({
    required this.product,
    required this.save,
    this.useIiko,
  });
  final Map<String, dynamic> product;
  final Future<void> Function(num) save;
  final Future<void> Function()? useIiko;
  @override
  State<_CashierQuantitySheet> createState() => _CashierQuantitySheetState();
}

class _CashierQuantitySheetState extends State<_CashierQuantitySheet> {
  late final TextEditingController _quantity = TextEditingController(
    text: '${widget.product['sourceQuantity'] ?? ''}',
  );
  String? _error;
  bool _saving = false;
  Future<void> _returnToIiko() async {
    setState(() => _saving = true);
    try {
      if (!await confirmCashierStockChange(context, widget.product, {
            'useIiko': true,
          }) ||
          !mounted) {
        return;
      }
      await widget.useIiko!();
      if (mounted) Navigator.pop(context);
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) => PopScope(
    canPop: !_saving,
    child: SafeArea(
      child: Padding(
        padding: EdgeInsets.fromLTRB(
          22,
          0,
          22,
          MediaQuery.viewInsetsOf(context).bottom + 24,
        ),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      staffText(
                        'Изменить остаток',
                        'Қалдықты өзгерту',
                        'Edit stock',
                      ),
                      style: const TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  IconButton(
                    tooltip: staffText('Закрыть', 'Жабу', 'Close'),
                    onPressed: _saving ? null : () => Navigator.pop(context),
                    icon: const Icon(Icons.close_rounded),
                  ),
                ],
              ),
              Text(
                '${widget.product['name']}',
                style: const TextStyle(fontSize: 14, color: Color(0xFF746B63)),
              ),
              const SizedBox(height: 22),
              TextField(
                controller: _quantity,
                autofocus: true,
                enabled: !_saving,
                keyboardType: const TextInputType.numberWithOptions(
                  decimal: true,
                ),
                inputFormatters: [
                  FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]')),
                  LengthLimitingTextInputFormatter(10),
                ],
                decoration: InputDecoration(
                  labelText:
                      '${staffText('На точке', 'Нүктедегі саны', 'On hand')}, ${widget.product['unit'] ?? 'шт'}',
                  errorText: _error,
                ),
              ),
              const SizedBox(height: 10),
              Text(
                '${staffText('В заказах', 'Тапсырыстарда', 'Reserved')}: ${widget.product['reserved'] ?? 0}',
                style: const TextStyle(fontSize: 12, color: Color(0xFF746B63)),
              ),
              const SizedBox(height: 24),
              if (widget.useIiko != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: OutlinedButton(
                    onPressed: _saving ? null : _returnToIiko,
                    child: Text(
                      staffText(
                        'Использовать остаток iikoFront',
                        'iikoFront қалдығын қолдану',
                        'Use iikoFront stock',
                      ),
                    ),
                  ),
                ),
              FilledButton(
                onPressed: _saving
                    ? null
                    : () async {
                        final value = num.tryParse(
                          _quantity.text.replaceAll(',', '.'),
                        );
                        final step =
                            (widget.product['quantityStep'] as num?) ?? 1;
                        if (value == null ||
                            value < 0 ||
                            value > 100000 ||
                            (value * 1000 - (value * 1000).round()).abs() >
                                0.000001 ||
                            (value * 1000).round() % (step * 1000).round() !=
                                0) {
                          setState(
                            () => _error = staffText(
                              'Введите число от 0 до 100 000',
                              '0 мен 100 000 аралығындағы санды енгізіңіз',
                              'Enter a number from 0 to 100,000',
                            ),
                          );
                          return;
                        }
                        setState(() {
                          _saving = true;
                          _error = null;
                        });
                        try {
                          if (!await confirmCashierStockChange(
                                context,
                                widget.product,
                                {'sourceQuantity': value},
                              ) ||
                              !mounted) {
                            return;
                          }
                          await widget.save(value);
                          if (context.mounted) Navigator.pop(context);
                        } catch (error) {
                          if (mounted) setState(() => _error = '$error');
                        } finally {
                          if (mounted) setState(() => _saving = false);
                        }
                      },
                child: Text(
                  _saving
                      ? staffText('Сохраняем…', 'Сақталуда…', 'Saving…')
                      : staffText('Сохранить', 'Сақтау', 'Save'),
                ),
              ),
            ],
          ),
        ),
      ),
    ),
  );
  @override
  void dispose() {
    _quantity.dispose();
    super.dispose();
  }
}
