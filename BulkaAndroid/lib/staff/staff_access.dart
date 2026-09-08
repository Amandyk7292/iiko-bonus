part of '../main.dart';

Map<String, String> staffRoleLabels() => {
  'owner': staffText('Владелец', 'Иесі', 'Owner'),
  'branch_manager': staffText(
    'Управляющий филиалом',
    'Филиал басшысы',
    'Branch manager',
  ),
  'operator': staffText('Оператор', 'Оператор', 'Operator'),
  'marketer': staffText('Маркетолог', 'Маркетолог', 'Marketer'),
  'courier': staffText('Курьер', 'Курьер', 'Courier'),
  'editor': staffText('Редактор', 'Редактор', 'Editor'),
  'viewer': staffText('Наблюдатель', 'Бақылаушы', 'Viewer'),
  'cashier': staffText('Кассир', 'Кассир', 'Cashier'),
};

class StaffAccess extends StatefulWidget {
  const StaffAccess({
    required this.api,
    required this.locations,
    required this.username,
    super.key,
  });
  final StaffApiClient api;
  final List<Map<String, dynamic>> locations;
  final String username;
  @override
  State<StaffAccess> createState() => _StaffAccessState();
}

class _StaffAccessState extends State<StaffAccess> {
  List<Map<String, dynamic>> _profiles = [];
  bool _loading = false;
  String? _error;
  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Map<String, String> get _branches => {
    for (final row in widget.locations)
      '${row['id']}': '${row['city']} · ${row['name']}',
  };
  Future<void> _load() async {
    if (!mounted || _loading) return;
    setState(() => _loading = true);
    try {
      final result = await widget.api.request('/access');
      final profiles = {
        for (final row in staffRows(result['profiles']))
          '${row['username']}': row,
      };
      for (final username in (result['configuredUsers'] as List?) ?? []) {
        profiles.putIfAbsent(
          '$username',
          () => {
            'username': username,
            'role': username == 'admin' ? 'owner' : 'viewer',
            'active': true,
            'branch_ids': [],
          },
        );
      }
      if (mounted) {
        setState(() {
          _profiles = profiles.values.toList();
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _edit(Map<String, dynamic> row) async {
    final self = row['username'] == widget.username && row['role'] == 'owner';
    final saved = await staffEdit(
      context,
      title: '${row['display_name'] ?? row['username']}',
      fields: [
        StaffField(
          'displayName',
          staffText('Имя сотрудника', 'Қызметкер аты', 'Employee name'),
          maxLength: 160,
        ),
        if (!self)
          StaffField(
            'role',
            staffText('Роль', 'Рөл', 'Role'),
            options: {
              for (final role in staffRoleLabels().entries)
                if (row['authMethod'] == 'password'
                    ? role.key == 'cashier'
                    : row['authMethod'] == 'whatsapp'
                    ? [
                        'branch_manager',
                        'operator',
                        'marketer',
                        'courier',
                        'viewer',
                      ].contains(role.key)
                    : role.key != 'editor')
                  role.key: role.value,
            },
          ),
        StaffField(
          'branchIds',
          staffText(
            'Доступные филиалы',
            'Қолжетімді филиалдар',
            'Accessible branches',
          ),
          type: 'multi',
          options: _branches,
        ),
        if (!self)
          StaffField(
            'active',
            staffText('Доступ разрешён', 'Кіруге рұқсат', 'Access enabled'),
            type: 'bool',
          ),
      ],
      initial: {
        'displayName': row['display_name'],
        'role': row['role'],
        'branchIds': row['branch_ids'] ?? [],
        'active': row['active'] != false,
      },
      save: (values) async {
        if (self) {
          values['role'] = 'owner';
          values['active'] = true;
        }
        if (values['role'] == 'cashier' &&
            (values['branchIds'] as List).length != 1) {
          throw Exception(
            staffText(
              'Выберите ровно один филиал для кассира',
              'Кассир үшін бір филиал таңдаңыз',
              'Select exactly one branch for a cashier',
            ),
          );
        }
        await widget.api.request(
          '/access/${Uri.encodeComponent('${row['username']}')}',
          method: 'PUT',
          body: values,
        );
      },
    );
    if (saved == true && mounted) unawaited(_load());
  }

  Future<void> _create() async {
    final method = await staffChooseFields(
      context,
      staffText('Способ входа', 'Кіру тәсілі', 'Sign-in method'),
      {
        'phone': staffText('По телефону', 'Телефонмен', 'Phone'),
        'password': staffText(
          'Логин и пароль',
          'Логин және құпиясөз',
          'Username and password',
        ),
      },
      ['phone'],
    );
    if (method == null || !mounted) return;
    final password = method.single == 'password';
    final saved = await staffEdit(
      context,
      title: staffText('Новый сотрудник', 'Жаңа қызметкер', 'New employee'),
      fields: [
        StaffField(
          'displayName',
          staffText('Имя', 'Аты', 'Name'),
          required: true,
          maxLength: 160,
        ),
        if (password) ...[
          StaffField(
            'username',
            staffText('Логин', 'Логин', 'Username'),
            required: true,
            maxLength: 64,
          ),
          StaffField(
            'password',
            staffText('Пароль', 'Құпиясөз', 'Password'),
            type: 'password',
            required: true,
            maxLength: 72,
            hint: staffText(
              'От 10 символов, буквы и цифры',
              '10 таңбадан бастап, әріптер мен сандар',
              'At least 10 characters, letters and digits',
            ),
          ),
        ] else
          StaffField(
            'phone',
            staffText('Телефон', 'Телефон', 'Phone'),
            type: 'phone',
            required: true,
            maxLength: 32,
          ),
        StaffField(
          'role',
          staffText('Роль', 'Рөл', 'Role'),
          options: {
            for (final role in staffRoleLabels().entries)
              if (password
                  ? role.key == 'cashier'
                  : [
                      'branch_manager',
                      'operator',
                      'marketer',
                      'courier',
                      'viewer',
                    ].contains(role.key))
                role.key: role.value,
          },
        ),
        StaffField(
          'branchIds',
          staffText('Филиалы', 'Филиалдар', 'Branches'),
          type: 'multi',
          options: _branches,
        ),
      ],
      initial: {'role': password ? 'cashier' : 'operator'},
      save: (values) async {
        if (values['role'] == 'cashier' &&
            (values['branchIds'] as List).length != 1) {
          throw Exception(
            staffText(
              'Кассиру нужен один филиал',
              'Кассирге бір филиал қажет',
              'Cashier needs one branch',
            ),
          );
        }
        await widget.api.request('/access', method: 'POST', body: values);
      },
    );
    if (saved == true && mounted) unawaited(_load());
  }

  Future<void> _password(Map<String, dynamic> row) async {
    await staffEdit(
      context,
      title: staffText('Новый пароль', 'Жаңа құпиясөз', 'New password'),
      description: '${row['display_name'] ?? row['username']}',
      fields: [
        StaffField(
          'password',
          staffText('Пароль', 'Құпиясөз', 'Password'),
          type: 'password',
          required: true,
          maxLength: 72,
          hint: staffText(
            'От 10 символов, буквы и цифры',
            '10 таңбадан бастап, әріптер мен сандар',
            'At least 10 characters, letters and digits',
          ),
        ),
      ],
      save: (values) async {
        await widget.api.request(
          '/access/${Uri.encodeComponent('${row['username']}')}/password',
          method: 'PUT',
          body: values,
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) => RefreshIndicator(
    onRefresh: _load,
    child: ListView(
      padding: const EdgeInsets.all(18),
      children: [
        FilledButton.icon(
          onPressed: _create,
          icon: const Icon(Icons.person_add_alt),
          label: Text(
            staffText('Добавить сотрудника', 'Қызметкер қосу', 'Add employee'),
          ),
        ),
        const SizedBox(height: 16),
        if (_loading) const LinearProgressIndicator(),
        if (_error != null) _StaffError(message: _error!, onRetry: _load),
        for (final row in _profiles)
          Card(
            margin: const EdgeInsets.symmetric(vertical: 8),
            child: Padding(
              padding: const EdgeInsets.all(18),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    '${row['display_name'] ?? row['username']}',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  Text('${row['username']}'),
                  const SizedBox(height: 10),
                  Text(staffRoleLabels()['${row['role']}'] ?? '${row['role']}'),
                  Text(
                    row['active'] != false
                        ? staffText(
                            'Доступ разрешён',
                            'Кіруге рұқсат',
                            'Access enabled',
                          )
                        : staffText(
                            'Доступ закрыт',
                            'Кіру жабық',
                            'Access disabled',
                          ),
                  ),
                  Text(
                    ((row['branch_ids'] as List?) ?? [])
                        .map((id) => _branches['$id'] ?? '$id')
                        .join(', '),
                  ),
                  const SizedBox(height: 12),
                  Wrap(
                    spacing: 12,
                    runSpacing: 8,
                    children: [
                      OutlinedButton(
                        onPressed: () => _edit(row),
                        child: Text(
                          staffText(
                            'Изменить доступ',
                            'Рұқсатты өзгерту',
                            'Edit access',
                          ),
                        ),
                      ),
                      if (row['authMethod'] == 'password' ||
                          row['role'] == 'cashier')
                        TextButton(
                          onPressed: () => _password(row),
                          child: Text(
                            staffText(
                              'Сменить пароль',
                              'Құпиясөзді өзгерту',
                              'Reset password',
                            ),
                          ),
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
