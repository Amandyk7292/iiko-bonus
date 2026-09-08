part of '../main.dart';

class _AdminPasswordLoginForm extends StatefulWidget {
  const _AdminPasswordLoginForm({
    required this.onLogin,
    required this.onAuthenticated,
    required this.onLoadingChanged,
    super.key,
  });

  final Future<void> Function(String, String, String) onLogin;
  final Future<void> Function() onAuthenticated;
  final ValueChanged<bool> onLoadingChanged;

  @override
  State<_AdminPasswordLoginForm> createState() =>
      _AdminPasswordLoginFormState();
}

class _AdminPasswordLoginFormState extends State<_AdminPasswordLoginForm> {
  final _username = TextEditingController(text: 'admin');
  final _password = TextEditingController();
  final _code = TextEditingController();
  bool _loading = false;
  bool _passwordVisible = false;
  bool _needsCode = false;
  String? _errorKey;

  @override
  void dispose() {
    _username.dispose();
    _password.dispose();
    _code.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_loading || _username.text.trim().isEmpty || _password.text.isEmpty) {
      return;
    }
    if (_needsCode && _code.text.length != 6) {
      setState(() => _errorKey = 'auth_admin_code_required');
      return;
    }
    FocusScope.of(context).unfocus();
    setState(() {
      _loading = true;
      _errorKey = null;
    });
    widget.onLoadingChanged(true);
    try {
      await widget.onLogin(_username.text.trim(), _password.text, _code.text);
      if (!mounted) return;
      _password.clear();
      _code.clear();
      await widget.onAuthenticated();
    } on AdminPortalLoginException catch (error) {
      if (!mounted) return;
      setState(() {
        _needsCode = _needsCode || error.needsCode;
        _errorKey = error.messageKey;
      });
    } catch (_) {
      if (mounted) setState(() => _errorKey = 'auth_admin_unavailable');
    } finally {
      if (mounted) {
        setState(() => _loading = false);
        widget.onLoadingChanged(false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return AutofillGroup(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _AuthStepHeader(
            title: 'auth_login_title'.tr,
            subtitle: 'auth_admin_subtitle'.tr,
          ),
          const SizedBox(height: 22),
          TextField(
            key: const ValueKey('auth-admin-username'),
            controller: _username,
            enabled: !_loading,
            autocorrect: false,
            enableSuggestions: false,
            autofillHints: const [AutofillHints.username],
            textInputAction: TextInputAction.next,
            onChanged: (_) => setState(() => _errorKey = null),
            decoration: _inputDecoration(
              context: context,
              label: 'auth_admin_username'.tr,
              icon: Icons.person_outline_rounded,
            ),
          ),
          const SizedBox(height: 16),
          TextField(
            key: const ValueKey('auth-admin-password'),
            controller: _password,
            enabled: !_loading,
            obscureText: !_passwordVisible,
            autocorrect: false,
            enableSuggestions: false,
            autofillHints: const [AutofillHints.password],
            textInputAction: _needsCode
                ? TextInputAction.next
                : TextInputAction.done,
            onSubmitted: (_) {
              if (!_needsCode) unawaited(_submit());
            },
            onChanged: (_) => setState(() => _errorKey = null),
            decoration:
                _inputDecoration(
                  context: context,
                  label: 'auth_password_label'.tr,
                  icon: Icons.lock_outline_rounded,
                ).copyWith(
                  suffixIcon: IconButton(
                    tooltip:
                        (_passwordVisible
                                ? 'auth_hide_password'
                                : 'auth_show_password')
                            .tr,
                    onPressed: () =>
                        setState(() => _passwordVisible = !_passwordVisible),
                    icon: Icon(
                      _passwordVisible
                          ? Icons.visibility_off_rounded
                          : Icons.visibility_rounded,
                    ),
                  ),
                ),
          ),
          if (_needsCode) ...[
            const SizedBox(height: 16),
            TextField(
              key: const ValueKey('auth-admin-code'),
              controller: _code,
              enabled: !_loading,
              keyboardType: TextInputType.number,
              inputFormatters: [
                FilteringTextInputFormatter.digitsOnly,
                LengthLimitingTextInputFormatter(6),
              ],
              autofillHints: const [AutofillHints.oneTimeCode],
              textInputAction: TextInputAction.done,
              onSubmitted: (_) => unawaited(_submit()),
              onChanged: (_) => setState(() => _errorKey = null),
              decoration: _inputDecoration(
                context: context,
                label: 'auth_admin_code_label'.tr,
              ),
            ),
          ],
          if (_errorKey != null) ...[
            const SizedBox(height: 14),
            _InlineAlert(
              message: _errorKey!.tr,
              icon: Icons.info_outline_rounded,
            ),
          ],
          const SizedBox(height: 26),
          KeyedSubtree(
            key: const ValueKey('auth-admin-submit'),
            child: _PrimaryButton(
              text: 'auth_login_button'.tr,
              icon: Icons.login_rounded,
              loading: _loading,
              onPressed:
                  !_loading &&
                      _username.text.trim().isNotEmpty &&
                      _password.text.isNotEmpty
                  ? _submit
                  : null,
            ),
          ),
        ],
      ),
    );
  }
}
