part of '../main.dart';

class StaffDesktopLogin extends StatelessWidget {
  const StaffDesktopLogin({
    required this.session,
    required this.onLogout,
    super.key,
  });
  final StaffAccountSession session;
  final Future<void> Function() onLogout;

  @override
  Widget build(BuildContext context) => Theme(
    data: staffTheme().copyWith(textTheme: Theme.of(context).textTheme),
    child: Scaffold(
      backgroundColor: const Color(0xFFF9F5EE),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 460),
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Align(
                              alignment: Alignment.centerLeft,
                              child: Image.asset(
                                'assets/brand/bulka_logo.png',
                                width: 120,
                                semanticLabel: 'Bulka',
                              ),
                            ),
                          ),
                          OutlinedButton(
                            onPressed: () async {
                              final lang = await showLanguageBottomSheet(
                                context,
                                initialCode: AppLang.current,
                              );
                              if (lang != null) await AppLang.setLanguage(lang);
                            },
                            child: Text(AppLang.shortLabel(AppLang.current)),
                          ),
                        ],
                      ),
                      const SizedBox(height: 24),
                      if (!session.isAuthenticated)
                        _AdminPasswordLoginForm(
                          onLogin: session.signIn,
                          onAuthenticated: () async {},
                          onLoadingChanged: (_) {},
                        )
                      else ...[
                        Text(
                          staffText(
                            'Войдите под аккаунтом кассира',
                            'Кассир аккаунтымен кіріңіз',
                            'Sign in with a cashier account',
                          ),
                          style: Theme.of(context).textTheme.titleLarge,
                        ),
                        const SizedBox(height: 20),
                        OutlinedButton(
                          onPressed: onLogout,
                          child: Text(staffText('Выйти', 'Шығу', 'Sign out')),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}
