part of '../main.dart';

class StaffBroadcast extends StatefulWidget {
  const StaffBroadcast({required this.api, super.key});
  final StaffApiClient api;
  @override
  State<StaffBroadcast> createState() => _StaffBroadcastState();
}

class _StaffBroadcastState extends State<StaffBroadcast> {
  final _titles = {
    for (final language in ['ru', 'kk', 'en'])
      language: TextEditingController(),
  };
  final _bodies = {
    for (final language in ['ru', 'kk', 'en'])
      language: TextEditingController(),
  };
  String _language = 'ru';
  String? _error, _result;
  bool _busy = false;
  Future<void> _preview() async {
    if (_busy) return;
    if (_titles.values.any((c) => c.text.trim().isEmpty) ||
        _bodies.values.any((c) => c.text.trim().isEmpty)) {
      setState(
        () => _error = staffText(
          'Заполните заголовок и текст на трёх языках',
          'Тақырып пен мәтінді үш тілде толтырыңыз',
          'Enter title and message in all three languages',
        ),
      );
      return;
    }
    final title = {
      for (final entry in _titles.entries) entry.key: entry.value.text.trim(),
    };
    final body = {
      for (final entry in _bodies.entries) entry.key: entry.value.text.trim(),
    };
    setState(() {
      _busy = true;
      _error = null;
      _result = null;
    });
    final sent = await staffEdit(
      context,
      title: staffText(
        'Отправить всем подписчикам?',
        'Барлық жазылушыларға жіберу керек пе?',
        'Send to all subscribers?',
      ),
      description: [
        for (final language in ['ru', 'kk', 'en'])
          '${language.toUpperCase()}\n${title[language]}\n${body[language]}',
      ].join('\n\n'),
      fields: [],
      submitLabel: staffText(
        'Отправить уведомления',
        'Хабарландыруларды жіберу',
        'Send notifications',
      ),
      save: (_) async {
        final result = await widget.api.request(
          '/push/mass',
          method: 'POST',
          body: {'titleTranslations': title, 'bodyTranslations': body},
        );
        _result =
            '${staffText('Отправлено', 'Жіберілді', 'Sent')}: ${result['count'] ?? 0}';
      },
    );
    if (mounted) {
      setState(() {
        _busy = false;
        if (sent == true) {
          for (final c in [..._titles.values, ..._bodies.values]) {
            c.clear();
          }
        }
      });
    }
  }

  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.all(18),
    children: [
      Text(
        staffText('Push-рассылка', 'Push-хабарландыру', 'Push campaign'),
        style: Theme.of(context).textTheme.headlineSmall,
      ),
      const SizedBox(height: 18),
      StaffPicker(
        label: staffText('Язык', 'Тіл', 'Language'),
        value: _language,
        options: {'ru': 'Русский', 'kk': 'Қазақша', 'en': 'English'},
        onChanged: (v) {
          if (!_busy) setState(() => _language = v);
        },
      ),
      const SizedBox(height: 18),
      TextField(
        controller: _titles[_language],
        enabled: !_busy,
        maxLength: 160,
        decoration: InputDecoration(
          labelText: staffText('Заголовок', 'Тақырып', 'Title'),
        ),
      ),
      const SizedBox(height: 12),
      TextField(
        controller: _bodies[_language],
        enabled: !_busy,
        maxLines: 5,
        maxLength: 2000,
        decoration: InputDecoration(
          labelText: staffText('Текст', 'Мәтін', 'Message'),
        ),
      ),
      const SizedBox(height: 18),
      Card(
        child: Padding(
          padding: const EdgeInsets.all(18),
          child: ListenableBuilder(
            listenable: Listenable.merge([
              _titles[_language]!,
              _bodies[_language]!,
            ]),
            builder: (context, _) => Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Icon(Icons.notifications_outlined),
                const SizedBox(height: 10),
                Text(
                  _titles[_language]!.text,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                Text(_bodies[_language]!.text),
              ],
            ),
          ),
        ),
      ),
      if (_error != null)
        Text(
          _error!,
          style: TextStyle(color: Theme.of(context).colorScheme.error),
        ),
      if (_result != null) SelectableText(_result!),
      const SizedBox(height: 18),
      FilledButton.icon(
        onPressed: _busy ? null : _preview,
        icon: const Icon(Icons.preview_outlined),
        label: Text(
          staffText(
            'Проверить и отправить',
            'Тексеру және жіберу',
            'Review and send',
          ),
        ),
      ),
    ],
  );
  @override
  void dispose() {
    for (final c in [..._titles.values, ..._bodies.values]) {
      c.dispose();
    }
    super.dispose();
  }
}
