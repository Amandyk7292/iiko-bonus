part of '../main.dart';

class StaffBonusPromos extends StatefulWidget {
  const StaffBonusPromos({required this.api, required this.promos, super.key});
  final StaffApiClient api;
  final List<Map<String, dynamic>> promos;
  @override
  State<StaffBonusPromos> createState() => _StaffBonusPromosState();
}

class _StaffBonusPromosState extends State<StaffBonusPromos> {
  late List<Map<String, dynamic>> _promos = List.from(widget.promos);
  final bool _busy = false;
  String? _error;
  Future<void> _persist(List<Map<String, dynamic>> next) async {
    await widget.api.request(
      '/settings',
      method: 'POST',
      body: {'bonus_promocodes': next},
    );
    if (mounted) setState(() => _promos = next);
  }

  Future<void> _edit([int? index]) async {
    await staffEdit(
      context,
      title: staffText('Промокод', 'Промокод', 'Promo code'),
      fields: [
        StaffField(
          'code',
          staffText('Код', 'Код', 'Code'),
          required: true,
          maxLength: 32,
        ),
        StaffField(
          'type',
          staffText('Скидка', 'Жеңілдік', 'Discount'),
          options: {'percent': '%', 'fixed': '₸'},
        ),
        StaffField(
          'value',
          staffText('Размер скидки', 'Жеңілдік мөлшері', 'Discount value'),
          type: 'number',
          required: true,
          minimum: .01,
        ),
        StaffField(
          'min_order',
          staffText(
            'Минимальная сумма заказа, ₸',
            'Ең аз тапсырыс сомасы, ₸',
            'Minimum order, ₸',
          ),
          type: 'number',
          required: true,
          minimum: 0,
        ),
      ],
      initial: index == null
          ? {'type': 'percent', 'value': 10, 'min_order': 0}
          : _promos[index],
      save: (values) async {
        values['code'] = '${values['code']}'.toUpperCase();
        if (values['type'] == 'percent' && (values['value'] as num) > 100) {
          throw Exception(
            staffText(
              'Скидка не больше 100%',
              'Жеңілдік 100%-дан аспайды',
              'Discount must not exceed 100%',
            ),
          );
        }
        if (_promos.indexed.any(
          (e) => e.$1 != index && e.$2['code'] == values['code'],
        )) {
          throw Exception(
            staffText(
              'Такой код уже есть',
              'Мұндай код бар',
              'Code already exists',
            ),
          );
        }
        final next = List<Map<String, dynamic>>.from(_promos);
        if (index == null) {
          next.add(values);
        } else {
          next[index] = values;
        }
        await _persist(next);
      },
    );
  }

  Future<void> _delete(int index) async {
    await staffEdit(
      context,
      title: staffText(
        'Удалить промокод?',
        'Промокодты жою керек пе?',
        'Delete promo code?',
      ),
      description: '${_promos[index]['code']}',
      fields: [],
      submitLabel: staffText('Удалить', 'Жою', 'Delete'),
      save: (_) async {
        await _persist(List.from(_promos)..removeAt(index));
      },
    );
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: Text(
        staffText(
          'Промокоды программы',
          'Бағдарлама промокодтары',
          'Program promo codes',
        ),
      ),
    ),
    body: ListView(
      padding: const EdgeInsets.all(18),
      children: [
        if (_busy) const LinearProgressIndicator(),
        if (_error != null) Text(_error!),
        FilledButton.icon(
          onPressed: _busy ? null : () => _edit(),
          icon: const Icon(Icons.add),
          label: Text(staffText('Добавить', 'Қосу', 'Add')),
        ),
        for (final (index, row) in _promos.indexed)
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    '${row['code']}',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  Text(
                    '${staffNumber(row['value'])}${row['type'] == 'percent' ? '%' : ' ₸'} · ${staffText('от', 'бастап', 'from')} ${staffMoney(row['min_order'])}',
                  ),
                  Wrap(
                    spacing: 10,
                    children: [
                      TextButton(
                        onPressed: () => _edit(index),
                        child: Text(staffText('Изменить', 'Өзгерту', 'Edit')),
                      ),
                      TextButton(
                        onPressed: () => _delete(index),
                        child: Text(staffText('Удалить', 'Жою', 'Delete')),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
      ],
    ),
  );
}
