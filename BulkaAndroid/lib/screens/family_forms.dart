part of '../main.dart';

class FamilyFormScreen extends StatefulWidget {
  const FamilyFormScreen({
    required this.api,
    this.child = false,
    this.member,
    super.key,
  });
  final BulkaApiClient api;
  final bool child;
  final Map<String, dynamic>? member;
  @override
  State<FamilyFormScreen> createState() => _FamilyFormScreenState();
}

class _FamilyFormScreenState extends State<FamilyFormScreen> {
  final _form = GlobalKey<FormState>();
  final _phone = TextEditingController();
  final _name = TextEditingController();
  final _login = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _limit = TextEditingController(text: '0');
  String _relation = 'wife';
  bool _blocked = false;
  bool _visible = false;
  bool _loading = false;
  String? _error;
  bool get _editing => widget.member != null;
  bool get _child =>
      _editing ? widget.member!['isChild'] == true : widget.child;
  static const _adultRoles = [
    'husband',
    'wife',
    'sister',
    'brother',
    'mother',
    'father',
    'grandmother',
    'grandfather',
  ];

  @override
  void initState() {
    super.initState();
    if (_editing) {
      _limit.text = _asInt(widget.member!['dailyLimit']).toString();
      _blocked = widget.member!['blocked'] == true;
    }
  }

  String? _required(String? value) =>
      value?.trim().isNotEmpty == true ? null : _familyText('required');
  String? _passwordError(String? value) {
    final password = value ?? '';
    if (_editing && password.isEmpty) return null;
    if (password.length < 8 ||
        utf8.encode(password).length > 72 ||
        !RegExp(r'\p{L}', unicode: true).hasMatch(password) ||
        !RegExp(r'\p{N}', unicode: true).hasMatch(password)) {
      return _familyText('invalidPassword');
    }
    return null;
  }

  Future<void> _save() async {
    if (_loading || !_form.currentState!.validate()) return;
    final limit = int.tryParse(_limit.text);
    final hiddenError = limit == null || limit < 0 || limit > 200000
        ? _familyText('invalidLimit')
        : _child
        ? _passwordError(_password.text)
        : null;
    if (hiddenError != null) {
      setState(() => _error = hiddenError);
      return;
    }
    FocusScope.of(context).unfocus();
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final dailyLimit = int.parse(_limit.text);
      if (_editing) {
        await widget.api.updateFamilyMember(_asString(widget.member!['id']), {
          'dailyLimit': dailyLimit,
          'blocked': _blocked,
          if (_password.text.isNotEmpty) 'password': _password.text,
        });
      } else if (_child) {
        await widget.api.createFamilyChild({
          'name': _name.text.trim(),
          'login': _login.text.trim(),
          'email': _email.text.trim(),
          'password': _password.text,
          'dailyLimit': dailyLimit,
        });
      } else {
        final digits = _phone.text.replaceAll(RegExp(r'\D'), '');
        await widget.api.inviteFamily(
          phone: '+7${digits.substring(digits.length - 10)}',
          relation: _relation,
          dailyLimit: dailyLimit,
        );
      }
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        bulkaSnackBar(
          content: Text(
            _familyText(
              _editing
                  ? 'updated'
                  : _child
                  ? 'childCreated'
                  : 'inviteSent',
            ),
          ),
        ),
      );
      Navigator.pop(context, true);
    } catch (error) {
      if (mounted) setState(() => _error = _familyError(error));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _remove() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(_familyText('remove')),
        content: Text(_familyText('removeHelp')),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text('cancel_btn'.tr),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(_familyText('remove')),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await widget.api.removeFamilyMember(_asString(widget.member!['id']));
      if (mounted) Navigator.pop(context, true);
    } catch (error) {
      if (mounted) setState(() => _error = _familyError(error));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  void dispose() {
    for (final controller in [
      _phone,
      _name,
      _login,
      _email,
      _password,
      _limit,
    ]) {
      controller.dispose();
    }
    super.dispose();
  }

  Widget _passwordField() => TextFormField(
    controller: _password,
    obscureText: !_visible,
    enableSuggestions: false,
    autocorrect: false,
    autofillHints: const [AutofillHints.newPassword],
    decoration: InputDecoration(
      labelText: _familyText('password'),
      helperText: _familyText('passwordHint'),
      helperMaxLines: 2,
      suffixIcon: IconButton(
        onPressed: () => setState(() => _visible = !_visible),
        tooltip: (_visible ? 'auth_hide_password' : 'auth_show_password').tr,
        icon: Icon(_visible ? Icons.visibility_off : Icons.visibility),
      ),
    ),
    validator: _passwordError,
    textInputAction: TextInputAction.next,
  );

  Widget _limitField() => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      TextFormField(
        controller: _limit,
        decoration: InputDecoration(
          labelText: _familyText('limit'),
          helperText: _familyText('limitHint'),
          helperMaxLines: 3,
        ),
        keyboardType: TextInputType.number,
        inputFormatters: [FilteringTextInputFormatter.digitsOnly],
        validator: (value) {
          final limit = int.tryParse(value ?? '');
          return limit == null || limit < 0 || limit > 200000
              ? _familyText('invalidLimit')
              : null;
        },
      ),
    ],
  );

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: _familyCanvas(context),
    appBar: AppBar(
      backgroundColor: _familyCanvas(context),
      title: _BulkaPageTitle(
        _familyText(
          _editing
              ? 'manage'
              : _child
              ? 'addChild'
              : 'invite',
        ),
      ),
    ),
    body: SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 480),
            child: Form(
              key: _form,
              child: _FamilyPanel(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if (_editing) ...[
                      Text(
                        _asString(widget.member!['name']),
                        style: const TextStyle(
                          fontFamily: _headingFont,
                          fontSize: 22,
                        ),
                      ),
                      Text(_familyRole(_asString(widget.member!['relation']))),
                      if (_child) ...[
                        const SizedBox(height: 12),
                        Text(
                          '${_familyText('login')}: ${_asString(widget.member!['login'])}',
                        ),
                        Text(_asString(widget.member!['email'])),
                      ],
                      const SizedBox(height: 20),
                    ] else if (_child) ...[
                      TextFormField(
                        controller: _name,
                        decoration: InputDecoration(
                          labelText: _familyText('name'),
                          counterText: '',
                        ),
                        validator: _required,
                        maxLength: 80,
                        textInputAction: TextInputAction.next,
                      ),
                      const SizedBox(height: 14),
                      TextFormField(
                        controller: _login,
                        decoration: InputDecoration(
                          labelText: _familyText('login'),
                        ),
                        autocorrect: false,
                        enableSuggestions: false,
                        validator: (value) =>
                            RegExp(
                              r'^[A-Za-z][A-Za-z0-9._-]{2,31}$',
                            ).hasMatch((value ?? '').trim())
                            ? null
                            : _familyText('invalidLogin'),
                        textInputAction: TextInputAction.next,
                      ),
                      const SizedBox(height: 14),
                      TextFormField(
                        controller: _email,
                        decoration: InputDecoration(
                          labelText: _familyText('email'),
                        ),
                        keyboardType: TextInputType.emailAddress,
                        autocorrect: false,
                        validator: (value) =>
                            RegExp(
                              r'^[^\s@]+@[^\s@]+\.[^\s@]+$',
                            ).hasMatch((value ?? '').trim())
                            ? null
                            : 'invalid_email'.tr,
                        textInputAction: TextInputAction.next,
                      ),
                      const SizedBox(height: 14),
                      _passwordField(),
                      const SizedBox(height: 24),
                    ] else ...[
                      TextFormField(
                        key: const ValueKey('family-invite-phone'),
                        controller: _phone,
                        decoration: InputDecoration(
                          labelText: _familyText('phone'),
                          floatingLabelBehavior: FloatingLabelBehavior.always,
                          hintText: '+7 700 123 45 67',
                        ),
                        keyboardType: TextInputType.phone,
                        validator: (value) {
                          final digits = (value ?? '').replaceAll(
                            RegExp(r'\D'),
                            '',
                          );
                          return digits.length == 10 ||
                                  (digits.length == 11 &&
                                      (digits.startsWith('7') ||
                                          digits.startsWith('8')))
                              ? null
                              : _familyText('invalidPhone');
                        },
                        textInputAction: TextInputAction.next,
                      ),
                      const SizedBox(height: 18),
                      DropdownButtonFormField<String>(
                        initialValue: _relation,
                        isExpanded: true,
                        decoration: InputDecoration(
                          labelText: _familyText('relation'),
                        ),
                        items: [
                          for (final role in _adultRoles)
                            DropdownMenuItem(
                              value: role,
                              child: Text(_familyRole(role)),
                            ),
                        ],
                        onChanged: _loading
                            ? null
                            : (value) => setState(() => _relation = value!),
                      ),
                      const SizedBox(height: 24),
                    ],
                    if (_editing || _child)
                      _limitField()
                    else
                      ExpansionTile(
                        tilePadding: EdgeInsets.zero,
                        childrenPadding: EdgeInsets.only(
                          top: MediaQuery.textScalerOf(context).scale(12),
                        ),
                        title: Text(_familyText('payment')),
                        children: [_limitField(), const SizedBox(height: 16)],
                      ),
                    if (_editing) ...[
                      const SizedBox(height: 16),
                      SwitchListTile(
                        contentPadding: EdgeInsets.zero,
                        title: Text(_familyText('block')),
                        value: _blocked,
                        onChanged: _loading
                            ? null
                            : (value) => setState(() => _blocked = value),
                      ),
                      if (_child)
                        ExpansionTile(
                          tilePadding: EdgeInsets.zero,
                          childrenPadding: EdgeInsets.only(
                            top: MediaQuery.textScalerOf(context).scale(12),
                          ),
                          title: Text(_familyText('resetPassword')),
                          children: [
                            _passwordField(),
                            const SizedBox(height: 12),
                          ],
                        ),
                    ],
                    if (_error != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 16),
                        child: _InlineAlert(
                          message: _error!,
                          icon: Icons.info_outline,
                        ),
                      ),
                    const SizedBox(height: 24),
                    _PrimaryButton(
                      text: _editing
                          ? 'save_btn'.tr
                          : _child
                          ? _familyText('addChild')
                          : _familyText('send'),
                      icon: _editing ? Icons.check : Icons.person_add_alt_1,
                      loading: _loading,
                      onPressed: _loading ? null : _save,
                    ),
                    if (_editing)
                      TextButton(
                        onPressed: _loading ? null : _remove,
                        child: Text(
                          _familyText('remove'),
                          style: const TextStyle(color: _errorRed),
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}
