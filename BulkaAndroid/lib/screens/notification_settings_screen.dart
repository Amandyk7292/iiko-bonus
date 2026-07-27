part of '../main.dart';

const _notificationPreferencesCacheKey = 'notification_preferences_cache_v1';

class NotificationSettingsScreen extends StatefulWidget {
  const NotificationSettingsScreen({required this.api, super.key});
  final BulkaApiClient api;

  @override
  State<NotificationSettingsScreen> createState() =>
      _NotificationSettingsScreenState();
}

class _NotificationSettingsScreenState
    extends State<NotificationSettingsScreen> {
  NotificationPreferences _preferences = const NotificationPreferences();
  bool _loading = true;
  bool _saving = false;
  bool _dirty = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    final prefs = await SharedPreferences.getInstance();
    final cached = prefs.getString(_notificationPreferencesCacheKey);
    if (cached != null) {
      try {
        final decoded = _asMap(jsonDecode(cached));
        if (decoded.isNotEmpty && mounted) {
          setState(() {
            _preferences = NotificationPreferences.fromJson(decoded);
            _loading = false;
          });
        }
      } catch (_) {}
    }
    try {
      final remote = await widget.api.getNotificationPreferences();
      await prefs.setString(
        _notificationPreferencesCacheKey,
        jsonEncode(remote.toJson()),
      );
      if (!mounted) return;
      setState(() {
        _preferences = remote;
        _error = null;
        _dirty = false;
      });
    } catch (error) {
      if (mounted) setState(() => _error = localizeErrorMessage(error));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _change(NotificationPreferences value) {
    setState(() {
      _preferences = value;
      _dirty = true;
      _error = null;
    });
  }

  TimeOfDay _parseTime(String value) {
    final parts = value.split(':');
    return TimeOfDay(
      hour: int.tryParse(parts.firstOrNull ?? '') ?? 0,
      minute: int.tryParse(parts.elementAtOrNull(1) ?? '') ?? 0,
    );
  }

  String _wireTime(TimeOfDay value) =>
      '${value.hour.toString().padLeft(2, '0')}:${value.minute.toString().padLeft(2, '0')}';

  Future<void> _pickTime({required bool start}) async {
    final current = _parseTime(
      start ? _preferences.quietStart : _preferences.quietEnd,
    );
    final selected = await showTimePicker(
      context: context,
      initialTime: current,
      helpText: start
          ? 'notifications_quiet_start'.tr
          : 'notifications_quiet_end'.tr,
    );
    if (selected == null) return;
    _change(
      start
          ? _preferences.copyWith(quietStart: _wireTime(selected))
          : _preferences.copyWith(quietEnd: _wireTime(selected)),
    );
  }

  Future<void> _save() async {
    if (_saving || !_dirty) return;
    setState(() => _saving = true);
    try {
      final saved = await widget.api.updateNotificationPreferences(
        _preferences,
      );
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        _notificationPreferencesCacheKey,
        jsonEncode(saved.toJson()),
      );
      if (!saved.ordersEnabled) await OrderLiveStatus.clear();
      if (!mounted) return;
      setState(() {
        _preferences = saved;
        _dirty = false;
        _error = null;
      });
      await BulkaMotion.confirm();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('notifications_settings_saved'.tr)),
        );
      }
    } catch (error) {
      if (mounted) setState(() => _error = localizeErrorMessage(error));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    return PopScope(
      canPop: !_dirty || _saving,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop || !_dirty || _saving) return;
        final discard = await showDialog<bool>(
          context: context,
          builder: (dialogContext) => AlertDialog(
            title: Text('notifications_unsaved_title'.tr),
            content: Text('notifications_unsaved_body'.tr),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(dialogContext, false),
                child: Text('cancel_btn'.tr),
              ),
              FilledButton(
                onPressed: () => Navigator.pop(dialogContext, true),
                child: Text('notifications_discard'.tr),
              ),
            ],
          ),
        );
        if (discard == true && context.mounted) Navigator.of(context).pop();
      },
      child: Scaffold(
        appBar: AppBar(
          toolbarHeight: BulkaLayout.appBarHeight(context),
          title: _BulkaPageTitle('notifications_settings_title'.tr),
          actions: const [SizedBox(width: BulkaLayout.appBarSideSlot)],
        ),
        body: _loading
            ? const Center(child: CircularProgressIndicator())
            : ListView(
                padding: const EdgeInsets.fromLTRB(18, 12, 18, 36),
                children: [
                  if (_error != null) ...[
                    _OrderNotice(
                      icon: Icons.cloud_off_rounded,
                      text: _error!,
                      color: colors.danger,
                    ),
                    const SizedBox(height: 14),
                  ],
                  _OrderSection(
                    title: 'notifications_categories'.tr,
                    child: Column(
                      children: [
                        _PreferenceSwitch(
                          icon: Icons.receipt_long_outlined,
                          title: 'notifications_orders'.tr,
                          subtitle: 'notifications_orders_hint'.tr,
                          value: _preferences.ordersEnabled,
                          onChanged: (value) => _change(
                            _preferences.copyWith(ordersEnabled: value),
                          ),
                        ),
                        _PreferenceSwitch(
                          icon: Icons.loyalty_outlined,
                          title: 'notifications_bonus'.tr,
                          subtitle: 'notifications_bonus_hint'.tr,
                          value: _preferences.bonusEnabled,
                          onChanged: (value) => _change(
                            _preferences.copyWith(bonusEnabled: value),
                          ),
                        ),
                        _PreferenceSwitch(
                          icon: Icons.campaign_outlined,
                          title: 'notifications_promos'.tr,
                          subtitle: 'notifications_promos_hint'.tr,
                          value: _preferences.promosEnabled,
                          onChanged: (value) => _change(
                            _preferences.copyWith(promosEnabled: value),
                          ),
                        ),
                        _PreferenceSwitch(
                          icon: Icons.support_agent_outlined,
                          title: 'notifications_support'.tr,
                          subtitle: 'notifications_support_hint'.tr,
                          value: _preferences.supportEnabled,
                          onChanged: (value) => _change(
                            _preferences.copyWith(supportEnabled: value),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),
                  _OrderSection(
                    title: 'notifications_quiet_hours'.tr,
                    child: Column(
                      children: [
                        SwitchListTile.adaptive(
                          contentPadding: EdgeInsets.zero,
                          value: _preferences.quietHoursEnabled,
                          onChanged: (value) => _change(
                            _preferences.copyWith(quietHoursEnabled: value),
                          ),
                          title: Text('notifications_quiet_enable'.tr),
                          subtitle: Text('notifications_quiet_hint'.tr),
                        ),
                        BulkaExpandable(
                          expanded: _preferences.quietHoursEnabled,
                          child: Padding(
                            padding: const EdgeInsets.only(top: 10),
                            child: Row(
                              children: [
                                Expanded(
                                  child: _TimeButton(
                                    label: 'notifications_quiet_start'.tr,
                                    value: _preferences.quietStart,
                                    onTap: () => _pickTime(start: true),
                                  ),
                                ),
                                const SizedBox(width: 10),
                                Expanded(
                                  child: _TimeButton(
                                    label: 'notifications_quiet_end'.tr,
                                    value: _preferences.quietEnd,
                                    onTap: () => _pickTime(start: false),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),
                  _OrderNotice(
                    icon: Icons.info_outline_rounded,
                    text: 'notifications_transactional_note'.tr,
                    color: colors.brandGold,
                  ),
                  const SizedBox(height: 20),
                  FilledButton.icon(
                    onPressed: _saving || !_dirty ? null : _save,
                    icon: _saving
                        ? const SizedBox.square(
                            dimension: 20,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.save_rounded),
                    label: Text('save_btn'.tr),
                    style: FilledButton.styleFrom(
                      minimumSize: const Size.fromHeight(54),
                    ),
                  ),
                ],
              ),
      ),
    );
  }
}

class _PreferenceSwitch extends StatelessWidget {
  const _PreferenceSwitch({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.value,
    required this.onChanged,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final bool value;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) => SwitchListTile.adaptive(
    contentPadding: EdgeInsets.zero,
    secondary: Icon(icon, color: context.bulkaColors.brandBrown),
    title: Text(
      title,
      style: const TextStyle(
        fontFamily: _headingFont,
        fontWeight: FontWeight.w700,
      ),
    ),
    subtitle: Text(subtitle),
    value: value,
    onChanged: onChanged,
  );
}

class _TimeButton extends StatelessWidget {
  const _TimeButton({
    required this.label,
    required this.value,
    required this.onTap,
  });

  final String label;
  final String value;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => OutlinedButton(
    onPressed: onTap,
    style: OutlinedButton.styleFrom(
      minimumSize: const Size.fromHeight(58),
      padding: const EdgeInsets.symmetric(horizontal: 12),
    ),
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(label, style: const TextStyle(fontSize: BulkaTypeScale.caption)),
        Text(
          value,
          style: const TextStyle(
            fontFamily: _headingFont,
            fontSize: BulkaTypeScale.titleSmall,
            fontWeight: FontWeight.w700,
          ),
        ),
      ],
    ),
  );
}
