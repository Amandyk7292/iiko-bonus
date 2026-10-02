part of '../main.dart';

class FamilyChildLoginScreen extends StatefulWidget {
  const FamilyChildLoginScreen({
    required this.onLogin,
    required this.onBack,
    this.onClose,
    super.key,
  });
  final Future<String?> Function(String login, String password) onLogin;
  final VoidCallback onBack;
  final VoidCallback? onClose;
  @override
  State<FamilyChildLoginScreen> createState() => _FamilyChildLoginScreenState();
}

class _FamilyChildLoginScreenState extends State<FamilyChildLoginScreen> {
  final _login = TextEditingController();
  final _password = TextEditingController();
  final _form = GlobalKey<FormState>();
  bool _visible = false;
  bool _loading = false;
  String? _error;

  Future<void> _submit() async {
    if (_loading || !_form.currentState!.validate()) return;
    FocusScope.of(context).unfocus();
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final error = await widget.onLogin(_login.text.trim(), _password.text);
      if (mounted) setState(() => _error = error);
    } catch (error) {
      if (mounted) setState(() => _error = _familyError(error));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  void dispose() {
    _login.dispose();
    _password.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: _familyCanvas(context),
    appBar: AppBar(
      backgroundColor: _familyCanvas(context),
      leading: IconButton(
        onPressed: _loading ? null : widget.onBack,
        tooltip: 'back_tooltip'.tr,
        icon: const Icon(Icons.arrow_back),
      ),
      title: _BulkaPageTitle(_familyText('childLogin')),
      actions: [
        if (widget.onClose != null)
          IconButton(
            onPressed: widget.onClose,
            tooltip: 'close_tooltip'.tr,
            icon: const Icon(Icons.close),
          ),
      ],
    ),
    body: SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 460),
            child: AutofillGroup(
              child: Form(
                key: _form,
                child: _FamilyPanel(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      const Center(child: _FamilyAvatar(name: '', child: true)),
                      const SizedBox(height: 24),
                      TextFormField(
                        controller: _login,
                        decoration: InputDecoration(
                          labelText: _familyText('login'),
                        ),
                        autocorrect: false,
                        enableSuggestions: false,
                        textInputAction: TextInputAction.next,
                        autofillHints: const [AutofillHints.username],
                        validator: (value) =>
                            value == null || value.trim().length < 3
                            ? _familyText('required')
                            : null,
                      ),
                      const SizedBox(height: 16),
                      TextFormField(
                        controller: _password,
                        obscureText: !_visible,
                        autocorrect: false,
                        enableSuggestions: false,
                        autofillHints: const [AutofillHints.password],
                        onFieldSubmitted: (_) => _submit(),
                        decoration: InputDecoration(
                          labelText: _familyText('password'),
                          suffixIcon: IconButton(
                            onPressed: () =>
                                setState(() => _visible = !_visible),
                            tooltip:
                                (_visible
                                        ? 'auth_hide_password'
                                        : 'auth_show_password')
                                    .tr,
                            icon: Icon(
                              _visible
                                  ? Icons.visibility_off
                                  : Icons.visibility,
                            ),
                          ),
                        ),
                        validator: (value) => value?.isNotEmpty != true
                            ? _familyText('required')
                            : null,
                      ),
                      if (_error != null)
                        Padding(
                          padding: const EdgeInsets.only(top: 16),
                          child: Text(
                            _error!,
                            style: const TextStyle(color: _errorRed),
                          ),
                        ),
                      const SizedBox(height: 24),
                      _PrimaryButton(
                        text: 'auth_login_button'.tr,
                        icon: Icons.login_rounded,
                        loading: _loading,
                        onPressed: _loading ? null : _submit,
                      ),
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
