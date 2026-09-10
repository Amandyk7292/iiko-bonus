part of '../main.dart';

ThemeData staffTheme() {
  const ink = Color(0xFF302B27),
      border = Color(0xFFE6DED5),
      brand = Color(0xFF55301D);
  final shape = RoundedRectangleBorder(borderRadius: BorderRadius.circular(12));
  final colors =
      ColorScheme.fromSeed(
        seedColor: brand,
        brightness: Brightness.light,
      ).copyWith(
        primary: brand,
        onPrimary: Colors.white,
        surface: Colors.white,
        onSurface: ink,
        surfaceContainer: Colors.white,
        surfaceContainerLow: Colors.white,
        surfaceContainerLowest: Colors.white,
        surfaceContainerHigh: Colors.white,
        surfaceContainerHighest: Colors.white,
        outline: border,
        outlineVariant: border,
      );
  return ThemeData(
    useMaterial3: true,
    fontFamily: _descriptionFont,
    colorScheme: colors,
    scaffoldBackgroundColor: Colors.white,
    canvasColor: Colors.white,
    dividerColor: border,
    appBarTheme: const AppBarTheme(
      backgroundColor: Colors.white,
      foregroundColor: ink,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: Colors.white,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      height: 72,
      indicatorColor: const Color(0xFFFFF1D3),
      labelTextStyle: WidgetStateProperty.resolveWith(
        (states) => TextStyle(
          fontSize: 12,
          fontWeight: states.contains(WidgetState.selected)
              ? FontWeight.w700
              : FontWeight.w500,
          color: ink,
        ),
      ),
    ),
    bottomSheetTheme: const BottomSheetThemeData(
      backgroundColor: Colors.white,
      surfaceTintColor: Colors.transparent,
    ),
    dialogTheme: const DialogThemeData(
      backgroundColor: Colors.white,
      surfaceTintColor: Colors.transparent,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.white,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 15),
      labelStyle: const TextStyle(fontSize: 13, color: Color(0xFF746B63)),
      hintStyle: const TextStyle(fontSize: 14, color: Color(0xFF93877C)),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: border),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: border),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: brand, width: 1.5),
      ),
    ),
    cardTheme: CardThemeData(
      color: Colors.white,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      margin: const EdgeInsets.symmetric(vertical: 6),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(18),
        side: const BorderSide(color: border),
      ),
    ),
    chipTheme: ChipThemeData(
      backgroundColor: Colors.white,
      selectedColor: const Color(0xFFFFF3D9),
      side: const BorderSide(color: border),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      labelStyle: const TextStyle(
        fontFamily: _descriptionFont,
        fontSize: 13,
        color: ink,
      ),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        shape: shape,
        minimumSize: const Size(48, 48),
        padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        shape: shape,
        side: const BorderSide(color: border),
        foregroundColor: ink,
        backgroundColor: Colors.white,
        minimumSize: const Size(48, 48),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      ),
    ),
  );
}

class StaffPageRoute<T> extends MaterialPageRoute<T> {
  StaffPageRoute({
    required WidgetBuilder builder,
    super.settings,
    super.fullscreenDialog,
  }) : super(
         builder: (context) => Theme(
           data: staffTheme(),
           child: Builder(builder: builder),
         ),
       );
}

String staffText(String ru, String kk, String en) => switch (AppLang.current) {
  'kk' => kk,
  'en' => en,
  _ => ru,
};

class StaffPicker extends StatelessWidget {
  const StaffPicker({
    required this.label,
    required this.value,
    required this.options,
    required this.onChanged,
    super.key,
  });
  final String label, value;
  final Map<String, String> options;
  final ValueChanged<String> onChanged;
  @override
  Widget build(BuildContext context) => SizedBox(
    width: double.infinity,
    child: OutlinedButton(
      style: OutlinedButton.styleFrom(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      ),
      onPressed: () async {
        final selected = await staffChooseFields(context, label, options, [
          value,
        ]);
        if (context.mounted && selected != null && selected.isNotEmpty) {
          onChanged(selected.first);
        }
      },
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w400,
                  ),
                ),
                const SizedBox(height: 5),
                Text(
                  options[value] ?? '—',
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 12),
          const Icon(Icons.expand_more),
        ],
      ),
    ),
  );
}

String staffSectionFromUri(Uri? uri) {
  final path = uri?.path.replaceFirst(RegExp(r'^/admin/?'), '') ?? '';
  return switch (path) {
    'iiko-dashboard' => 'dashboard',
    'iiko-front' => 'iiko',
    'whatsapp-access' => 'whatsapp',
    '' => 'operations',
    _ => path.split('/').first,
  };
}

/// Native employee workspace, sharing only the server API with the website.
class NativeStaffApp extends StatefulWidget {
  const NativeStaffApp({this.api, this.initialUri, super.key});
  final StaffApiClient? api;
  final Uri? initialUri;
  @override
  State<NativeStaffApp> createState() => _NativeStaffAppState();
}

class _NativeStaffAppState extends State<NativeStaffApp> {
  late final StaffApiClient _api = widget.api ?? StaffApiClient();
  Map<String, dynamic>? _user;
  bool _restoring = true;
  String? _error;
  @override
  void initState() {
    super.initState();
    _api.onUnauthorized = () {
      if (!mounted) return;
      setState(() => _user = null);
      final root = ModalRoute.of(context);
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && root != null) {
          Navigator.of(context).popUntil((route) => route == root);
        }
      });
    };
    unawaited(_restore());
  }

  Future<void> _restore() async {
    setState(() {
      _restoring = true;
      _error = null;
    });
    try {
      final uri = widget.initialUri;
      final operatorAccess =
          uri != null &&
          isTrustedAdminPortalUri(uri, bulkaAdminPortalUri()) &&
          uri.path == '/admin/whatsapp-access';
      final user = operatorAccess
          ? await _api.exchangeOperatorAccess(Uri.decodeComponent(uri.fragment))
          : await _api.restore();
      if (mounted) setState(() => _user = user);
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _restoring = false);
    }
  }

  @override
  void dispose() {
    _api.onUnauthorized = null;
    if (widget.api == null) _api.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Theme(
    data: staffTheme(),
    child: Builder(builder: _body),
  );

  Widget _body(BuildContext context) {
    if (_restoring) {
      return Scaffold(
        appBar: AppBar(),
        body: const Center(child: CircularProgressIndicator()),
      );
    }
    if (_error != null) {
      return Scaffold(
        appBar: AppBar(),
        body: _StaffError(message: _error!, onRetry: _restore),
      );
    }
    if (_user == null) {
      return _StaffLogin(
        api: _api,
        onLogin: (user) => setState(() => _user = user),
      );
    }
    return StaffWorkspace(
      api: _api,
      user: _user!,
      initialSection: staffSectionFromUri(widget.initialUri),
      onLogout: () async {
        await _api.logout();
        if (mounted) setState(() => _user = null);
      },
    );
  }
}

class _StaffLogin extends StatefulWidget {
  const _StaffLogin({required this.api, required this.onLogin});
  final StaffApiClient api;
  final ValueChanged<Map<String, dynamic>> onLogin;
  @override
  State<_StaffLogin> createState() => _StaffLoginState();
}

class _StaffLoginState extends State<_StaffLogin> {
  final _form = GlobalKey<FormState>();
  final _username = TextEditingController();
  final _password = TextEditingController();
  final _code = TextEditingController();
  final _phone = TextEditingController();
  bool _byPhone = false, _requested = false, _busy = false, _hidden = true;
  String? _error;
  Uri? _whatsapp;
  @override
  void dispose() {
    _username.dispose();
    _password.dispose();
    _code.dispose();
    _phone.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_busy || !_form.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      if (_byPhone && !_requested) {
        final data = await widget.api.requestPhone(_phone.text);
        final uri = Uri.tryParse('${data['whatsappUrl'] ?? ''}');
        if (mounted) {
          setState(() {
            _requested = true;
            _whatsapp =
                uri != null &&
                    uri.scheme == 'https' &&
                    ['wa.me', 'api.whatsapp.com'].contains(uri.host)
                ? uri
                : null;
          });
        }
      } else {
        final user = _byPhone
            ? await widget.api.verifyPhone(_phone.text, _code.text)
            : await widget.api.login(
                _username.text,
                _password.text,
                _code.text,
              );
        _password.clear();
        _code.clear();
        if (mounted) widget.onLogin(user);
      }
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String? _required(String? value) => value == null || value.trim().isEmpty
      ? staffText('Заполните поле', 'Өрісті толтырыңыз', 'Required')
      : null;
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(),
    body: SafeArea(
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 480),
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: AutofillGroup(
              child: Form(
                key: _form,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Center(
                      child: Image.asset(
                        'assets/brand/bulka_logo.png',
                        width: 120,
                        height: 72,
                      ),
                    ),
                    const SizedBox(height: 24),
                    Text(
                      staffText(
                        'Вход для сотрудников',
                        'Қызметкерлерге кіру',
                        'Staff sign in',
                      ),
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.headlineSmall,
                    ),
                    const SizedBox(height: 24),
                    Wrap(
                      alignment: WrapAlignment.center,
                      spacing: 12,
                      runSpacing: 8,
                      children: [
                        for (final phone in [false, true])
                          ChoiceChip(
                            selected: _byPhone == phone,
                            label: Text(
                              phone
                                  ? staffText(
                                      'По телефону',
                                      'Телефон арқылы',
                                      'Phone',
                                    )
                                  : staffText(
                                      'По паролю',
                                      'Құпиясөзбен',
                                      'Password',
                                    ),
                            ),
                            onSelected: _busy
                                ? null
                                : (_) => setState(() {
                                    _byPhone = phone;
                                    _requested = false;
                                    _error = null;
                                    _code.clear();
                                  }),
                          ),
                      ],
                    ),
                    const SizedBox(height: 20),
                    if (_byPhone)
                      TextFormField(
                        controller: _phone,
                        enabled: !_busy && !_requested,
                        keyboardType: TextInputType.phone,
                        autofillHints: const [AutofillHints.telephoneNumber],
                        decoration: InputDecoration(
                          labelText: staffText('Телефон', 'Телефон', 'Phone'),
                        ),
                        validator: _required,
                      )
                    else ...[
                      TextFormField(
                        controller: _username,
                        enabled: !_busy,
                        autocorrect: false,
                        autofillHints: const [AutofillHints.username],
                        textInputAction: TextInputAction.next,
                        decoration: InputDecoration(
                          labelText: staffText('Логин', 'Логин', 'Username'),
                        ),
                        validator: _required,
                      ),
                      const SizedBox(height: 16),
                      TextFormField(
                        controller: _password,
                        enabled: !_busy,
                        obscureText: _hidden,
                        autofillHints: const [AutofillHints.password],
                        decoration: InputDecoration(
                          labelText: staffText(
                            'Пароль',
                            'Құпиясөз',
                            'Password',
                          ),
                          suffixIcon: IconButton(
                            tooltip: staffText(
                              'Показать или скрыть пароль',
                              'Құпиясөзді көрсету немесе жасыру',
                              'Show or hide password',
                            ),
                            onPressed: () => setState(() => _hidden = !_hidden),
                            icon: Icon(
                              _hidden
                                  ? Icons.visibility_outlined
                                  : Icons.visibility_off_outlined,
                            ),
                          ),
                        ),
                        validator: _required,
                      ),
                    ],
                    if (!_byPhone || _requested) ...[
                      const SizedBox(height: 16),
                      TextFormField(
                        controller: _code,
                        enabled: !_busy,
                        keyboardType: TextInputType.number,
                        autofillHints: const [AutofillHints.oneTimeCode],
                        inputFormatters: [
                          FilteringTextInputFormatter.digitsOnly,
                          LengthLimitingTextInputFormatter(6),
                        ],
                        decoration: InputDecoration(
                          labelText: _byPhone
                              ? staffText(
                                  'Код подтверждения',
                                  'Растау коды',
                                  'Verification code',
                                )
                              : staffText(
                                  'Код 2FA, если включён',
                                  'Қосылған болса, 2FA коды',
                                  '2FA code, if enabled',
                                ),
                        ),
                        validator: (value) =>
                            _byPhone && (value?.length ?? 0) != 6
                            ? staffText(
                                'Введите 6 цифр',
                                '6 санды енгізіңіз',
                                'Enter 6 digits',
                              )
                            : null,
                      ),
                    ],
                    if (_byPhone && _requested)
                      TextButton(
                        onPressed: _busy
                            ? null
                            : () => setState(() {
                                _requested = false;
                                _code.clear();
                              }),
                        child: Text(
                          staffText(
                            'Изменить номер',
                            'Нөмірді өзгерту',
                            'Change phone',
                          ),
                        ),
                      ),
                    if (_whatsapp != null && _byPhone && _requested)
                      TextButton.icon(
                        onPressed: () => launchUrl(
                          _whatsapp!,
                          mode: LaunchMode.externalApplication,
                        ),
                        icon: const Icon(Icons.chat_outlined),
                        label: const Text('WhatsApp'),
                      ),
                    if (_error != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 16),
                        child: Text(
                          _error!,
                          style: TextStyle(
                            color: Theme.of(context).colorScheme.error,
                          ),
                        ),
                      ),
                    const SizedBox(height: 24),
                    GradientButton(
                      onPressed: _submit,
                      loading: _busy,
                      child: Text(
                        _byPhone && !_requested
                            ? staffText('Получить код', 'Код алу', 'Get code')
                            : staffText('Войти', 'Кіру', 'Sign in'),
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

class _StaffError extends StatelessWidget {
  const _StaffError({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;
  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(message, textAlign: TextAlign.center),
          const SizedBox(height: 16),
          OutlinedButton.icon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh),
            label: Text('retry_btn'.tr),
          ),
        ],
      ),
    ),
  );
}
