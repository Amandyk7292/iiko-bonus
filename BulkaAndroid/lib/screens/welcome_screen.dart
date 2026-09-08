part of '../main.dart';

/// Defers customer navigation until the first-run language choice is complete.
class BulkaWelcomeGate extends StatefulWidget {
  const BulkaWelcomeGate({required this.child, super.key});
  final Widget child;
  static const completedKey = 'bulka_welcome_completed_v1';

  @override
  State<BulkaWelcomeGate> createState() => _BulkaWelcomeGateState();
}

class _BulkaWelcomeGateState extends State<BulkaWelcomeGate> {
  bool? _completed;
  bool _saving = false;
  bool _failed = false;
  String _language = AppLang.current;

  @override
  void initState() {
    super.initState();
    unawaited(_restore());
  }

  Future<void> _restore() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      if (mounted) {
        setState(
          () => _completed =
              prefs.getBool(BulkaWelcomeGate.completedKey) ?? false,
        );
      }
    } catch (_) {
      if (mounted) setState(() => _completed = false);
    }
  }

  Future<void> _continue() async {
    if (_saving) return;
    setState(() {
      _saving = true;
      _failed = false;
    });
    try {
      await AppLang.setLanguage(_language);
      final prefs = await SharedPreferences.getInstance();
      final saved = await prefs.setBool(BulkaWelcomeGate.completedKey, true);
      if (!saved) throw StateError('Welcome preference was not saved');
      if (mounted) setState(() => _completed = true);
    } catch (_) {
      if (mounted) setState(() => _failed = true);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  String _copy(String ru, String kk, String en) => switch (_language) {
    'kk' => kk,
    'en' => en,
    _ => ru,
  };

  @override
  Widget build(BuildContext context) {
    if (_completed == true) return BulkaPermissionGate(child: widget.child);
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      locale: Locale(_language),
      supportedLocales: const [Locale('ru'), Locale('kk'), Locale('en')],
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      theme: buildBulkaTheme(),
      builder: _buildBulkaAppViewport,
      home: _completed == null
          ? SplashScreen(text: 'splash_loading'.tr)
          : Scaffold(
              backgroundColor: Colors.white,
              body: SafeArea(
                child: LayoutBuilder(
                  builder: (context, constraints) {
                    return SingleChildScrollView(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 24,
                        vertical: 28,
                      ),
                      child: ConstrainedBox(
                        constraints: BoxConstraints(
                          minHeight: max(0, constraints.maxHeight - 56),
                        ),
                        child: Center(
                          child: ConstrainedBox(
                            constraints: const BoxConstraints(maxWidth: 440),
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                Center(
                                  child: Image.asset(
                                    'assets/brand/bulka_logo.png',
                                    width: 144,
                                    height: 80,
                                    fit: BoxFit.contain,
                                    semanticLabel: 'Bulka',
                                  ),
                                ),
                                const SizedBox(height: 32),
                                Text(
                                  _copy(
                                    'Добро пожаловать в Bulka',
                                    'Bulka-ға қош келдіңіз',
                                    'Welcome to Bulka',
                                  ),
                                  key: const ValueKey('welcome-title'),
                                  textAlign: TextAlign.center,
                                  style: Theme.of(context)
                                      .textTheme
                                      .headlineMedium
                                      ?.copyWith(fontWeight: FontWeight.w600),
                                ),
                                const SizedBox(height: 12),
                                Text(
                                  _copy(
                                    'Выберите язык приложения',
                                    'Қолданба тілін таңдаңыз',
                                    'Choose your app language',
                                  ),
                                  textAlign: TextAlign.center,
                                  style: Theme.of(context).textTheme.bodyLarge,
                                ),
                                const SizedBox(height: 28),
                                for (final entry in const {
                                  'ru': 'Русский',
                                  'kk': 'Қазақша',
                                  'en': 'English',
                                }.entries)
                                  Padding(
                                    padding: const EdgeInsets.only(bottom: 12),
                                    child: Semantics(
                                      selected: _language == entry.key,
                                      child: OutlinedButton(
                                        key: ValueKey(
                                          'welcome-language-${entry.key}',
                                        ),
                                        onPressed: _saving
                                            ? null
                                            : () => setState(
                                                () => _language = entry.key,
                                              ),
                                        style: OutlinedButton.styleFrom(
                                          backgroundColor:
                                              _language == entry.key
                                              ? const Color(0xFFFFE48A)
                                              : Colors.white,
                                          padding: const EdgeInsets.symmetric(
                                            horizontal: 20,
                                            vertical: 18,
                                          ),
                                        ),
                                        child: Row(
                                          children: [
                                            const SizedBox(width: 24),
                                            Expanded(
                                              child: Text(
                                                entry.value,
                                                textAlign: TextAlign.center,
                                              ),
                                            ),
                                            SizedBox(
                                              width: 24,
                                              child: _language == entry.key
                                                  ? const Icon(
                                                      Icons.check_rounded,
                                                    )
                                                  : null,
                                            ),
                                          ],
                                        ),
                                      ),
                                    ),
                                  ),
                                const SizedBox(height: 16),
                                if (_failed)
                                  Padding(
                                    padding: const EdgeInsets.only(bottom: 12),
                                    child: Text(
                                      _copy(
                                        'Не удалось сохранить выбор. Повторите попытку.',
                                        'Таңдау сақталмады. Қайталап көріңіз.',
                                        'Could not save your choice. Please try again.',
                                      ),
                                      textAlign: TextAlign.center,
                                      style: TextStyle(
                                        color: Theme.of(
                                          context,
                                        ).colorScheme.error,
                                      ),
                                    ),
                                  ),
                                GradientButton(
                                  key: const ValueKey('welcome-continue'),
                                  onPressed: _continue,
                                  loading: _saving,
                                  child: Text(
                                    _copy(
                                      'Продолжить',
                                      'Жалғастыру',
                                      'Continue',
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    );
                  },
                ),
              ),
            ),
    );
  }
}
