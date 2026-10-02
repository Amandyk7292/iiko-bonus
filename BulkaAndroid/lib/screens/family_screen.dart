part of '../main.dart';

class FamilyScreen extends StatefulWidget {
  const FamilyScreen({
    required this.api,
    required this.onRefreshProfile,
    super.key,
  });
  final BulkaApiClient api;
  final Future<void> Function() onRefreshProfile;
  @override
  State<FamilyScreen> createState() => _FamilyScreenState();
}

class _FamilyScreenState extends State<FamilyScreen> {
  Map<String, dynamic>? _family;
  String? _error;
  bool _loading = true;
  bool _working = false;
  bool get _owner => _family?['isOwner'] == true;
  bool get _canManage => _owner || _family?['groupId'] == null;
  List<Map<String, dynamic>> _items(String key) =>
      (_family?[key] is List ? _family![key] as List : const [])
          .map(_asMap)
          .toList();

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    try {
      final family = await widget.api.getFamily();
      if (mounted) {
        setState(() {
          _family = family;
          _error = null;
          _loading = false;
        });
      }
    } catch (error) {
      if (mounted) {
        setState(() {
          _error = _familyError(error);
          _loading = false;
        });
      }
    }
  }

  Future<bool> _confirm(String title, String message, String action) async =>
      await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text(title),
          content: Text(message),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: Text('cancel_btn'.tr),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: Text(action),
            ),
          ],
        ),
      ) ==
      true;

  Future<void> _act(Future<Object?> Function() operation) async {
    if (_working) return;
    setState(() {
      _working = true;
      _error = null;
    });
    try {
      await operation();
      await _load();
      await widget.onRefreshProfile();
    } catch (error) {
      if (mounted) setState(() => _error = _familyError(error));
    } finally {
      if (mounted) setState(() => _working = false);
    }
  }

  Future<void> _answer(Map<String, dynamic> invitation, bool accept) async {
    if (accept &&
        !await _confirm(
          _familyText('joinTitle'),
          _familyText('joinHelp'),
          _familyText('accept'),
        )) {
      return;
    }
    await _act(
      () => widget.api.answerFamilyInvitation(
        _asString(invitation['id']),
        accept: accept,
      ),
    );
  }

  Future<void> _form({bool child = false, Map<String, dynamic>? member}) async {
    final changed = await Navigator.push<bool>(
      context,
      MaterialPageRoute(
        builder: (_) =>
            FamilyFormScreen(api: widget.api, child: child, member: member),
      ),
    );
    if (changed == true) {
      await _load();
      await widget.onRefreshProfile();
    }
  }

  Future<void> _remove(String id, {bool leave = false}) async {
    final action = _familyText(leave ? 'leave' : 'remove');
    if (!await _confirm(
      action,
      _familyText(leave ? 'leaveHelp' : 'removeHelp'),
      action,
    )) {
      return;
    }
    await _act(() => widget.api.removeFamilyMember(id));
  }

  @override
  Widget build(BuildContext context) {
    final members = _items('members');
    final mine = members
        .where((m) => m['id'] == _family?['memberId'])
        .firstOrNull;
    return Scaffold(
      backgroundColor: _familyCanvas(context),
      appBar: AppBar(
        backgroundColor: _familyCanvas(context),
        title: _BulkaPageTitle(_familyText('title')),
        actions: [
          IconButton(
            onPressed: _working ? null : _load,
            tooltip: 'retry_btn'.tr,
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: SafeArea(
        child: _loading
            ? const Center(child: CircularProgressIndicator())
            : RefreshIndicator(
                onRefresh: _load,
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
                  children: [
                    Center(
                      child: ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: 580),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            if (_error != null) ...[
                              _InlineAlert(
                                message: _error!,
                                icon: Icons.info_outline,
                              ),
                              const SizedBox(height: 12),
                              if (_family == null)
                                TextButton(
                                  onPressed: _load,
                                  child: Text('retry_btn'.tr),
                                ),
                            ],
                            if (_working) const LinearProgressIndicator(),
                            if (_family != null) ...[
                              _FamilyBonusHero(
                                balance: _asDouble(_family!['sharedBalance']),
                                owner: _owner || _family!['groupId'] == null
                                    ? null
                                    : _asString(_family!['ownerName']),
                                members: _owner ? members.length : 0,
                              ),
                              const SizedBox(height: 16),
                              if (_items('invitations').isNotEmpty) ...[
                                _heading(_familyText('invitations')),
                                for (final invitation in _items('invitations'))
                                  _invitationCard(invitation),
                              ],
                              if (_canManage) ...[
                                Row(
                                  children: [
                                    Expanded(child: _addAction(child: false)),
                                    const SizedBox(width: 12),
                                    Expanded(child: _addAction(child: true)),
                                  ],
                                ),
                                const SizedBox(height: 24),
                              ],
                              if (_family!['groupId'] != null) ...[
                                _heading(
                                  _familyText('members'),
                                  count: members.length,
                                ),
                                if (members.isEmpty) Text(_familyText('empty')),
                                for (final member in members)
                                  _memberCard(member),
                              ],
                              if (!_owner &&
                                  mine != null &&
                                  mine['blocked'] != true &&
                                  _asDouble(mine['dailyLimit']) > 0) ...[
                                const SizedBox(height: 12),
                                FilledButton.icon(
                                  onPressed: _working
                                      ? null
                                      : () => _openPaymentQr(mine),
                                  icon: const Icon(Icons.qr_code_rounded),
                                  label: Text(_familyText('paymentQr')),
                                ),
                              ],
                              if (!_owner && _family!['memberId'] != null)
                                TextButton(
                                  onPressed: _working
                                      ? null
                                      : () => _remove(
                                          _asString(_family!['memberId']),
                                          leave: true,
                                        ),
                                  child: Text(
                                    _familyText('leave'),
                                    style: const TextStyle(color: _errorRed),
                                  ),
                                ),
                              if (_owner &&
                                  _items('sentInvitations').isNotEmpty) ...[
                                const SizedBox(height: 16),
                                _heading(_familyText('sent')),
                                for (final invitation in _items(
                                  'sentInvitations',
                                ))
                                  _sentCard(invitation),
                              ],
                            ],
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
              ),
      ),
    );
  }

  Widget _addAction({required bool child}) => Material(
    color: child
        ? context.bulkaColors.surfaceCream
        : context.bulkaColors.brandBrown,
    borderRadius: BorderRadius.circular(20),
    child: InkWell(
      key: ValueKey(child ? 'family-add-child' : 'family-invite'),
      onTap: _working ? null : () => _form(child: child),
      borderRadius: BorderRadius.circular(20),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 16),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              child ? Icons.face_rounded : Icons.person_add_alt_1_rounded,
              size: 20,
              color: child ? context.bulkaColors.brandBrown : Colors.white,
            ),
            const SizedBox(width: 8),
            Flexible(
              child: Text(
                _familyText(child ? 'childShort' : 'inviteShort'),
                softWrap: false,
                maxLines: 1,
                style: TextStyle(
                  fontFamily: _headingFont,
                  fontSize: 12,
                  color: child ? context.bulkaColors.brandBrown : Colors.white,
                ),
              ),
            ),
          ],
        ),
      ),
    ),
  );

  Widget _memberCard(Map<String, dynamic> member) => Padding(
    padding: const EdgeInsets.only(bottom: 10),
    child: _FamilyPanel(
      padding: 14,
      child: Row(
        children: [
          _FamilyAvatar(
            name: _asString(member['name']),
            child: member['isChild'] == true,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _asString(member['name']),
                  style: const TextStyle(
                    fontFamily: _headingFont,
                    fontSize: 14,
                  ),
                ),
                const SizedBox(height: 6),
                Wrap(
                  spacing: 6,
                  runSpacing: 4,
                  children: [
                    _FamilyRoleChip(_familyRole(_asString(member['relation']))),
                    if (member['blocked'] == true)
                      _FamilyRoleChip(_familyText('blocked'), blocked: true),
                  ],
                ),
                if (member['dailyLimit'] != null &&
                    _asDouble(member['dailyLimit']) > 0) ...[
                  const SizedBox(height: 8),
                  Text(
                    '${formatMoney(_asDouble(member['dailyLimit']))} ₸ / ${_familyText('perDay')}',
                    style: TextStyle(
                      fontSize: 11,
                      color: context.bulkaColors.mutedText,
                    ),
                  ),
                ],
              ],
            ),
          ),
          if (_owner)
            IconButton(
              onPressed: _working ? null : () => _form(member: member),
              tooltip: _familyText('manage'),
              icon: const Icon(Icons.chevron_right_rounded),
            ),
        ],
      ),
    ),
  );

  Widget _invitationCard(Map<String, dynamic> invitation) => Padding(
    padding: const EdgeInsets.only(bottom: 16),
    child: _FamilyPanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              _FamilyAvatar(name: _asString(invitation['ownerName'])),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      _asString(invitation['ownerName']),
                      style: const TextStyle(
                        fontFamily: _headingFont,
                        fontSize: 16,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      _familyRole(_asString(invitation['relation'])),
                      style: TextStyle(
                        fontSize: 12,
                        color: context.bulkaColors.mutedText,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          if (_asDouble(invitation['dailyLimit']) > 0) ...[
            const SizedBox(height: 12),
            Text(
              '${_familyText('dailyLimit')}: ${formatMoney(_asDouble(invitation['dailyLimit']))} ₸',
              style: const TextStyle(fontSize: 12),
            ),
          ],
          const SizedBox(height: 16),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              FilledButton(
                onPressed: _working ? null : () => _answer(invitation, true),
                child: Text(_familyText('accept'), softWrap: false),
              ),
              TextButton(
                onPressed: _working ? null : () => _answer(invitation, false),
                child: Text(_familyText('decline'), softWrap: false),
              ),
            ],
          ),
        ],
      ),
    ),
  );

  Widget _sentCard(Map<String, dynamic> invitation) => Padding(
    padding: const EdgeInsets.only(bottom: 10),
    child: _FamilyPanel(
      padding: 14,
      child: Row(
        children: [
          Icon(
            Icons.mail_outline_rounded,
            color: context.bulkaColors.mutedText,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _asString(invitation['name']),
                  style: const TextStyle(
                    fontFamily: _headingFont,
                    fontSize: 14,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  '${_familyRole(_asString(invitation['relation']))} · ${_familyText(_asString(invitation['status']))}',
                  style: TextStyle(
                    fontSize: 11,
                    color: context.bulkaColors.mutedText,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    ),
  );

  void _openPaymentQr(Map<String, dynamic> mine) => Navigator.push<void>(
    context,
    MaterialPageRoute(
      builder: (_) => Scaffold(
        backgroundColor: _familyCanvas(context),
        appBar: AppBar(
          title: _BulkaPageTitle(_familyText('payment')),
          backgroundColor: _familyCanvas(context),
        ),
        body: SafeArea(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(16),
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 420),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    _FamilyPanel(
                      child: FamilyQrWidget(api: widget.api, payment: true),
                    ),
                    const SizedBox(height: 16),
                    _FamilyPanel(
                      child: Text(
                        '${_familyText('dailyLimit')}: ${formatMoney(_asDouble(mine['dailyLimit']))} ₸',
                        textAlign: TextAlign.center,
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

  Widget _heading(String text, {int? count}) => Padding(
    padding: const EdgeInsets.only(bottom: 12),
    child: Row(
      children: [
        Expanded(
          child: Text(
            text,
            style: const TextStyle(fontFamily: _headingFont, fontSize: 16),
          ),
        ),
        if (count != null) _FamilyRoleChip('$count'),
      ],
    ),
  );
}
