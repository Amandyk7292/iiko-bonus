part of '../main.dart';

class CashierProductionProduct {
  CashierProductionProduct(Map<String, dynamic> row)
    : id = '${row['productId'] ?? ''}',
      name = '${row['productName'] ?? ''}',
      unit = '${row['unit'] ?? ''}',
      quantity = num.tryParse('${row['quantity']}'),
      eventIds =
          (row['eventIds'] as List? ?? const [])
              .whereType<String>()
              .where((id) => id.isNotEmpty)
              .toSet()
              .toList()
            ..sort(),
      eligible = row['eligible'] == true,
      reason = '${row['reason'] ?? ''}',
      reasonCode = '${row['reasonCode'] ?? ''}';
  final String id, name, unit, reason, reasonCode;
  final num? quantity;
  final List<String> eventIds;
  final bool eligible;
  String get key => '$id:$unit';
  String get snapshot => '$key:${quantity ?? ''}:${eventIds.join(',')}';
  bool get selectable =>
      eligible &&
      id.isNotEmpty &&
      unit.isNotEmpty &&
      quantity != null &&
      quantity!.isFinite &&
      quantity! > 0 &&
      eventIds.isNotEmpty;
}

class CashierProductionAct {
  CashierProductionAct(Map<String, dynamic> row)
    : id = '${row['id'] ?? ''}',
      status = '${row['status'] ?? 'unknown'}',
      date = '${row['date'] ?? ''}',
      eventIds =
          (row['eventIds'] as List? ?? const [])
              .whereType<String>()
              .toSet()
              .toList()
            ..sort(),
      number = '${row['documentNumber'] ?? ''}',
      requestedNumber = '${row['requestedDocumentNumber'] ?? ''}',
      error = '${row['error'] ?? ''}',
      errorCode = '${row['errorCode'] ?? ''}';
  final String id, status, date, number, requestedNumber, error, errorCode;
  final List<String> eventIds;
  bool get unresolved => !['created', 'failed'].contains(status);
  String get label => switch (status) {
    'created' => staffText('Создан', 'Құрылды', 'Created'),
    'failed' => staffText('Не создан', 'Құрылмады', 'Not created'),
    'pending' => staffText(
      'Ожидает отправки',
      'Жіберуді күтуде',
      'Awaiting send',
    ),
    'sending' => staffText('Отправляется', 'Жіберілуде', 'Sending'),
    _ => staffText('Требует проверки', 'Тексеру қажет', 'Check required'),
  };
}

class CashierProductionReport {
  CashierProductionReport(Map<String, dynamic> row)
    : date = '${row['date'] ?? ''}',
      branch = row['branch'] is Map
          ? Map<String, dynamic>.from(row['branch'] as Map)
          : const {},
      enabled = row['enabled'] == true,
      unavailableReason = '${row['unavailableReason'] ?? ''}',
      unavailableReasonCode = '${row['unavailableReasonCode'] ?? ''}',
      products = staffRows(
        row['products'],
      ).map(CashierProductionProduct.new).toList(),
      acts = staffRows(row['acts']).map(CashierProductionAct.new).toList();
  final String date, unavailableReason, unavailableReasonCode;
  final Map<String, dynamic> branch;
  final bool enabled;
  final List<CashierProductionProduct> products;
  final List<CashierProductionAct> acts;
}

String _productionReason(String message, String code) {
  if (appLanguageNotifier.value == 'ru' && message.isNotEmpty) return message;
  return switch (code) {
    'PRODUCTION_CUSTOM_PRODUCT' || 'custom_product' => staffText(
      'Товар не связан с iiko',
      'Тауар iiko-мен байланыспаған',
      'Product is not linked to iiko',
    ),
    'IIKO_PRODUCTION_PRODUCT_UNMAPPED' => staffText(
      'Блюдо не найдено в iiko',
      'Тағам iiko-да табылмады',
      'Dish not found in iiko',
    ),
    'IIKO_PRODUCTION_UNIT_MISMATCH' ||
    'PRODUCTION_UNIT_MISMATCH' ||
    'unit_mismatch' => staffText(
      'Единица отличается от iiko',
      'Өлшем бірлігі iiko-дан өзгеше',
      'Unit differs from iiko',
    ),
    'IIKO_PRODUCTION_BINDING_MISSING' => staffText(
      'Настройте акт для точки',
      'Нүкте үшін актіні баптаңыз',
      'Configure the branch act',
    ),
    'IIKO_PRODUCTION_DISABLED' => staffText(
      'Отправка актов отключена',
      'Акт жіберу өшірілген',
      'Act sending is disabled',
    ),
    'IIKO_PRODUCTION_QUANTITY_INVALID' => staffText(
      'Проверьте количество',
      'Санын тексеріңіз',
      'Check the quantity',
    ),
    'IIKO_PRODUCTION_SOURCE_UNAVAILABLE' ||
    'IIKO_PRODUCTION_SERVER_UNAVAILABLE' => staffText(
      'iiko недоступен. Обновите отчёт',
      'iiko қолжетімсіз. Есепті жаңартыңыз',
      'iiko unavailable. Refresh the report',
    ),
    'IIKO_PRODUCTION_EVENTS_CHANGED' ||
    'IIKO_PRODUCTION_PRODUCTS_CHANGED' ||
    'IIKO_PRODUCTION_BINDING_CHANGED' => staffText(
      'Отчёт изменился. Обновите данные',
      'Есеп өзгерді. Деректерді жаңартыңыз',
      'Report changed. Refresh the data',
    ),
    'IIKO_PRODUCTION_REQUEST_CONFLICT' => staffText(
      'Запрос изменился. Обновите отчёт',
      'Сұрау өзгерді. Есепті жаңартыңыз',
      'Request changed. Refresh the report',
    ),
    'IIKO_PRODUCTION_DATE_INVALID' => staffText(
      'Выберите дату отчёта',
      'Есеп күнін таңдаңыз',
      'Select the report date',
    ),
    'IIKO_PRODUCTION_INPUT_INVALID' => staffText(
      'Проверьте выбранные товары',
      'Таңдалған тауарларды тексеріңіз',
      'Check the selected products',
    ),
    'IIKO_PRODUCTION_REJECTED' => staffText(
      'iiko отклонил акт',
      'iiko актіні қабылдамады',
      'iiko rejected the act',
    ),
    'IIKO_PRODUCTION_CONFIRMATION_REQUIRED' ||
    'IIKO_PRODUCTION_UNCONFIRMED' => staffText(
      'Проверьте акт в iiko и сообщите администратору.',
      'iiko-дағы актіні тексеріп, әкімшіге хабарлаңыз.',
      'Check the act in iiko and contact the administrator.',
    ),
    'IIKO_PRODUCTION_BRANCH_UNAVAILABLE' ||
    'IIKO_PRODUCTION_CITY_MISMATCH' ||
    'IIKO_PRODUCTION_DIRECTORY_INVALID' ||
    'IIKO_PRODUCTION_STORE_MISMATCH' ||
    'IIKO_PRODUCTION_BINDING_INVALID' => staffText(
      'Проверьте настройку точки в iiko',
      'iiko-дағы нүкте баптауын тексеріңіз',
      'Check the branch setup in iiko',
    ),
    _ => staffText(
      'Недоступно для iiko',
      'iiko үшін қолжетімсіз',
      'Unavailable for iiko',
    ),
  };
}

String _productionTotals(Iterable<CashierProductionProduct> products) {
  final totals = <String, num>{};
  for (final product in products) {
    totals.update(
      product.unit,
      (value) => value + (product.quantity ?? 0),
      ifAbsent: () => product.quantity ?? 0,
    );
  }
  return totals.entries
      .map((row) => '${_cashierQuantity(row.value)} ${row.key}')
      .join(' · ');
}

class _ProductionWords extends StatelessWidget {
  const _ProductionWords(this.value, {this.horizontalInset = 112, this.style});
  final String value;
  final double horizontalInset;
  final TextStyle? style;
  @override
  Widget build(BuildContext context) {
    final textStyle = DefaultTextStyle.of(context).style.merge(style);
    final width = max(48.0, MediaQuery.sizeOf(context).width - horizontalInset);
    final direction = Directionality.of(context);
    return Semantics(
      label: value,
      excludeSemantics: true,
      child: Wrap(
        spacing: 4,
        runSpacing: 2,
        children: value
            .split(RegExp(r'\s+'))
            .where((word) => word.isNotEmpty)
            .map((word) {
              final painter = TextPainter(
                text: TextSpan(text: word, style: textStyle),
                textDirection: direction,
                textScaler: MediaQuery.textScalerOf(context),
              )..layout();
              final wordWidth = painter.width;
              painter.dispose();
              return SizedBox(
                width: min(width, wordWidth + 1),
                child: SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Text(word, style: textStyle, softWrap: false),
                ),
              );
            })
            .toList(),
      ),
    );
  }
}

Widget _productionProductRow(
  BuildContext context,
  CashierProductionProduct product, {
  required bool selected,
  required bool enabled,
  required ValueChanged<bool> onChanged,
}) => Card(
  key: ValueKey('production-product:${product.key}'),
  margin: const EdgeInsets.only(bottom: 8),
  color: selected ? Theme.of(context).colorScheme.primaryContainer : null,
  child: CheckboxListTile(
    key: ValueKey('production-select:${product.key}'),
    value: selected,
    controlAffinity: ListTileControlAffinity.leading,
    contentPadding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
    onChanged: enabled && product.selectable
        ? (value) => onChanged(value ?? false)
        : null,
    title: _ProductionWords(product.name),
    subtitle: Padding(
      padding: const EdgeInsets.only(top: 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '+${_cashierQuantity(product.quantity)} ${product.unit}',
            style: const TextStyle(fontWeight: FontWeight.w700),
          ),
          if (!product.selectable)
            Text(
              _productionReason(product.reason, product.reasonCode),
              style: Theme.of(context).textTheme.bodySmall,
            ),
        ],
      ),
    ),
  ),
);

Widget _productionActRow(
  BuildContext context,
  CashierProductionAct act, {
  VoidCallback? onResume,
}) => Container(
  key: ValueKey('production-act:${act.id}'),
  padding: const EdgeInsets.all(12),
  margin: const EdgeInsets.only(bottom: 8),
  decoration: BoxDecoration(
    border: Border.all(color: Theme.of(context).colorScheme.outline),
    borderRadius: BorderRadius.circular(12),
  ),
  child: Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Wrap(
        spacing: 8,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          Icon(
            act.status == 'created'
                ? Icons.check_circle_outline
                : act.status == 'failed'
                ? Icons.error_outline
                : Icons.schedule,
            size: 20,
          ),
          Text(act.label, style: const TextStyle(fontWeight: FontWeight.w700)),
        ],
      ),
      if (act.number.isNotEmpty || act.requestedNumber.isNotEmpty)
        Padding(
          padding: const EdgeInsets.only(top: 4),
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Text(
              '№ ${act.number.isNotEmpty ? act.number : act.requestedNumber}',
              softWrap: false,
            ),
          ),
        ),
      if (act.status == 'pending' && act.eventIds.isNotEmpty)
        Align(
          alignment: Alignment.centerLeft,
          child: TextButton.icon(
            key: ValueKey('production-resume:${act.id}'),
            onPressed: onResume,
            icon: const Icon(Icons.send_outlined, size: 18),
            label: Text(staffText('Продолжить', 'Жалғастыру', 'Continue')),
          ),
        ),
      if (!['pending', 'sending', 'created', 'failed'].contains(act.status))
        Padding(
          padding: const EdgeInsets.only(top: 6),
          child: Text(
            staffText(
              'Проверьте акт в iiko и сообщите администратору.',
              'iiko-дағы актіні тексеріп, әкімшіге хабарлаңыз.',
              'Check the act in iiko and contact the administrator.',
            ),
            key: ValueKey('production-manual-check:${act.id}'),
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ),
      if (act.status == 'failed' && act.error.isNotEmpty)
        Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Text(_productionReason(act.error, act.errorCode)),
        ),
    ],
  ),
);

Future<bool> _confirmProduction(
  BuildContext context,
  CashierProductionReport report,
  List<CashierProductionProduct> products,
) async =>
    await showDialog<bool>(
      context: context,
      builder: (dialogContext) => CallbackShortcuts(
        bindings: {
          const SingleActivator(LogicalKeyboardKey.escape): () =>
              Navigator.pop(dialogContext, false),
        },
        child: BulkaActionDialog(
          title: Text(staffText('Создать акт', 'Акт құру', 'Create act')),
          content: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _ProductionWords(
                '${report.branch['name'] ?? ''}',
                horizontalInset: 128,
                style: const TextStyle(fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 4),
              Text(report.date.split('-').reversed.join('.')),
              const SizedBox(height: 16),
              for (final product in products)
                Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _ProductionWords(product.name, horizontalInset: 128),
                      Text(
                        '${_cashierQuantity(product.quantity)} ${product.unit}',
                        style: const TextStyle(fontWeight: FontWeight.w700),
                      ),
                    ],
                  ),
                ),
            ],
          ),
          actions: [
            FilledButton(
              key: const ValueKey('production-confirm'),
              autofocus: true,
              onPressed: () => Navigator.pop(dialogContext, true),
              child: Text(
                staffText('Отправить в iiko', 'iiko-ға жіберу', 'Send to iiko'),
              ),
            ),
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: Text(staffText('Назад', 'Артқа', 'Back')),
            ),
          ],
        ),
      ),
    ) ??
    false;
