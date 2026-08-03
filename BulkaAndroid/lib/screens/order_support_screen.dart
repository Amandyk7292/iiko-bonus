part of '../main.dart';

class OrderSupportScreen extends StatefulWidget {
  const OrderSupportScreen({
    required this.api,
    this.initialOrder,
    this.initialRequestId,
    super.key,
  });

  final BulkaApiClient api;
  final CustomerOrder? initialOrder;
  final String? initialRequestId;

  @override
  State<OrderSupportScreen> createState() => _OrderSupportScreenState();
}

class _OrderSupportScreenState extends State<OrderSupportScreen> {
  final TextEditingController _message = TextEditingController();
  final ImagePicker _picker = ImagePicker();
  String _category = 'order_issue';
  bool _refundRequested = false;
  bool _submitting = false;
  bool _loading = true;
  String? _error;
  List<XFile> _images = const [];
  List<SupportRequest> _requests = const [];
  StreamSubscription<Map<String, dynamic>>? _events;
  Timer? _reloadTimer;
  bool _initialThreadOpened = false;

  @override
  void initState() {
    super.initState();
    if (widget.initialOrder == null) _category = 'other';
    _events = widget.api.customerEvents.listen((event) {
      final type = _asString(event['type']);
      if (type != 'support.created' && type != 'support.updated') return;
      _reloadTimer?.cancel();
      _reloadTimer = Timer(const Duration(milliseconds: 250), () {
        if (mounted) unawaited(_load(silent: true));
      });
    });
    unawaited(_load());
  }

  @override
  void dispose() {
    _reloadTimer?.cancel();
    _events?.cancel();
    _message.dispose();
    super.dispose();
  }

  Future<void> _load({bool silent = false}) async {
    if (!silent && mounted) setState(() => _loading = true);
    try {
      final requests = await widget.api.getSupportRequests();
      if (!mounted) return;
      setState(() {
        _requests = widget.initialOrder == null
            ? requests
            : requests
                  .where((item) => item.orderId == widget.initialOrder!.id)
                  .toList();
        _error = null;
      });
      final initialRequestId = widget.initialRequestId?.trim() ?? '';
      if (!_initialThreadOpened && initialRequestId.isNotEmpty) {
        SupportRequest? requested;
        for (final request in _requests) {
          if (request.id == initialRequestId) {
            requested = request;
            break;
          }
        }
        if (requested != null) {
          _initialThreadOpened = true;
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (mounted) unawaited(_openThread(requested!));
          });
        }
      }
    } catch (error) {
      if (mounted) setState(() => _error = localizeErrorMessage(error));
    } finally {
      if (!silent && mounted) setState(() => _loading = false);
    }
  }

  Future<void> _openThread(SupportRequest request) async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) =>
            _SupportThreadScreen(api: widget.api, initialRequest: request),
      ),
    );
    if (mounted) unawaited(_load(silent: true));
  }

  Future<void> _pickImages() async {
    try {
      final selected = await _picker.pickMultiImage(
        imageQuality: 82,
        maxWidth: 1600,
        maxHeight: 1600,
      );
      if (!mounted || selected.isEmpty) return;
      setState(() => _images = [..._images, ...selected].take(3).toList());
    } catch (error) {
      if (!mounted) return;
      showApiErrorSnackBar(context, error);
    }
  }

  Future<void> _submit() async {
    final text = _message.text.trim();
    if (_submitting || text.length < 5) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('support_message_required'.tr)));
      return;
    }
    setState(() => _submitting = true);
    try {
      final attachments = await Future.wait(
        _images.map(
          (image) async => widget.api.uploadSupportAttachment(
            bytes: await image.readAsBytes(),
            fileName: image.name,
          ),
        ),
      );
      final request = await widget.api.createSupportRequest(
        orderId: widget.initialOrder?.id,
        category: _category,
        message: text,
        refundRequested: _refundRequested,
        attachments: attachments,
      );
      if (!mounted) return;
      setState(() {
        _requests = [request, ..._requests];
        _images = const [];
        _message.clear();
        _refundRequested = false;
      });
      await BulkaMotion.confirm();
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('support_sent'.tr)));
      }
    } catch (error) {
      if (!mounted) return;
      showApiErrorSnackBar(context, error);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    return Scaffold(
      appBar: AppBar(
        toolbarHeight: BulkaLayout.appBarHeight(context),
        title: _BulkaPageTitle('support_title'.tr),
        actions: const [SizedBox(width: BulkaLayout.appBarSideSlot)],
      ),
      body: RefreshIndicator(
        color: colors.brandGold,
        onRefresh: _load,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(18, 12, 18, 36),
          children: [
            if (widget.initialOrder != null)
              _SupportOrderBanner(order: widget.initialOrder!),
            if (widget.initialOrder != null) const SizedBox(height: 14),
            _OrderSection(
              title: 'support_new_request'.tr,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  DropdownButtonFormField<String>(
                    initialValue: _category,
                    decoration: InputDecoration(
                      labelText: 'support_category'.tr,
                      prefixIcon: const Icon(Icons.topic_outlined),
                    ),
                    items:
                        const [
                              'order_issue',
                              'product_quality',
                              'delivery',
                              'refund',
                              'other',
                            ]
                            .map(
                              (value) => DropdownMenuItem(
                                value: value,
                                child: Text('support_category_$value'.tr),
                              ),
                            )
                            .toList(),
                    onChanged: _submitting
                        ? null
                        : (value) {
                            if (value == null) return;
                            setState(() {
                              _category = value;
                              if (value == 'refund') _refundRequested = true;
                            });
                          },
                  ),
                  const SizedBox(height: 14),
                  TextField(
                    controller: _message,
                    enabled: !_submitting,
                    minLines: 4,
                    maxLines: 8,
                    maxLength: 2000,
                    textCapitalization: TextCapitalization.sentences,
                    decoration: InputDecoration(
                      labelText: 'support_message_label'.tr,
                      hintText: 'support_message_hint'.tr,
                      alignLabelWithHint: true,
                    ),
                  ),
                  if (widget.initialOrder?.paymentStatus == 'paid') ...[
                    SwitchListTile.adaptive(
                      contentPadding: EdgeInsets.zero,
                      value: _refundRequested,
                      onChanged: _submitting
                          ? null
                          : (value) => setState(() {
                              _refundRequested = value;
                              if (value) _category = 'refund';
                            }),
                      title: Text('support_refund_request'.tr),
                      subtitle: Text('support_refund_disclaimer'.tr),
                    ),
                  ],
                  const SizedBox(height: 6),
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: _submitting || _images.length >= 3
                              ? null
                              : _pickImages,
                          icon: const Icon(Icons.add_photo_alternate_outlined),
                          label: Text(
                            'support_add_photo'.trArgs({
                              'count': _images.length,
                            }),
                          ),
                          style: OutlinedButton.styleFrom(
                            minimumSize: const Size.fromHeight(50),
                          ),
                        ),
                      ),
                    ],
                  ),
                  if (_images.isNotEmpty) ...[
                    const SizedBox(height: 10),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        for (var index = 0; index < _images.length; index++)
                          InputChip(
                            avatar: const Icon(Icons.image_outlined, size: 18),
                            label: ConstrainedBox(
                              constraints: const BoxConstraints(maxWidth: 150),
                              child: Text(
                                _images[index].name,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                            onDeleted: _submitting
                                ? null
                                : () => setState(() {
                                    _images = [
                                      for (var i = 0; i < _images.length; i++)
                                        if (i != index) _images[i],
                                    ];
                                  }),
                          ),
                      ],
                    ),
                  ],
                  const SizedBox(height: 16),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton.icon(
                      onPressed: _submitting ? null : _submit,
                      icon: _submitting
                          ? const SizedBox.square(
                              dimension: 20,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.send_rounded),
                      label: Text(
                        _submitting ? 'support_sending'.tr : 'support_send'.tr,
                      ),
                      style: FilledButton.styleFrom(
                        minimumSize: const Size.fromHeight(54),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 24),
            Text(
              'support_history'.tr,
              style: const TextStyle(
                fontFamily: _headingFont,
                fontSize: BulkaTypeScale.title,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 12),
            if (_loading)
              const Center(child: CircularProgressIndicator())
            else if (_error != null && _requests.isEmpty)
              _OrderNotice(
                icon: Icons.cloud_off_rounded,
                text: _error!,
                color: colors.danger,
              )
            else if (_requests.isEmpty)
              _OrderNotice(
                icon: Icons.forum_outlined,
                text: 'support_history_empty'.tr,
                color: colors.brandGold,
              )
            else
              for (final request in _requests) ...[
                _SupportRequestCard(
                  request: request,
                  onTap: () => _openThread(request),
                ),
                const SizedBox(height: 10),
              ],
          ],
        ),
      ),
    );
  }
}

class _SupportOrderBanner extends StatelessWidget {
  const _SupportOrderBanner({required this.order});
  final CustomerOrder order;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(16),
    decoration: BoxDecoration(
      color: context.bulkaColors.brandGold.withValues(alpha: .14),
      borderRadius: BorderRadius.circular(BulkaRadii.control),
      border: Border.all(color: context.bulkaColors.cardBorder),
    ),
    child: Row(
      children: [
        const Icon(Icons.receipt_long_rounded),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'order_details_title'.trArgs({'number': order.number}),
                style: const TextStyle(
                  fontFamily: _headingFont,
                  fontWeight: FontWeight.w700,
                ),
              ),
              Text(
                order.branch,
                style: TextStyle(color: context.bulkaColors.mutedText),
              ),
            ],
          ),
        ),
      ],
    ),
  );
}

class _SupportRequestCard extends StatelessWidget {
  const _SupportRequestCard({required this.request, required this.onTap});
  final SupportRequest request;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    final statusColor = switch (request.status) {
      'resolved' => colors.success,
      'rejected' => colors.danger,
      'in_review' => colors.warning,
      _ => colors.brandGold,
    };
    return Semantics(
      button: true,
      label:
          '${'support_category_${request.category}'.tr}. ${'support_status_${request.status}'.tr}',
      child: Material(
        color: Theme.of(context).colorScheme.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(BulkaRadii.control),
          side: BorderSide(color: colors.cardBorder),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        'support_category_${request.category}'.tr,
                        style: const TextStyle(
                          fontFamily: _headingFont,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 6,
                      ),
                      decoration: BoxDecoration(
                        color: statusColor.withValues(alpha: .12),
                        borderRadius: BorderRadius.circular(BulkaRadii.pill),
                      ),
                      child: Text(
                        'support_status_${request.status}'.tr,
                        style: TextStyle(
                          fontFamily: _headingFont,
                          color: statusColor,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 9),
                Text(request.message),
                if (request.attachments.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  Text(
                    'support_photos_count'.trArgs({
                      'count': request.attachments.length,
                    }),
                    style: TextStyle(
                      color: colors.mutedText,
                      fontSize: BulkaTypeScale.caption,
                    ),
                  ),
                ],
                if (request.resolution?.isNotEmpty == true) ...[
                  const Divider(height: 24),
                  Text(
                    'support_team_reply'.tr,
                    style: const TextStyle(
                      fontFamily: _headingFont,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(request.resolution!),
                ],
                const SizedBox(height: 12),
                Row(
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: [
                    Text(
                      'support_open_conversation'.tr,
                      style: TextStyle(
                        color: colors.brandGold,
                        fontFamily: _headingFont,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(width: 4),
                    Icon(
                      Icons.arrow_forward_rounded,
                      size: 18,
                      color: colors.brandGold,
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _SupportThreadScreen extends StatefulWidget {
  const _SupportThreadScreen({required this.api, required this.initialRequest});

  final BulkaApiClient api;
  final SupportRequest initialRequest;

  @override
  State<_SupportThreadScreen> createState() => _SupportThreadScreenState();
}

class _SupportThreadScreenState extends State<_SupportThreadScreen> {
  final TextEditingController _reply = TextEditingController();
  final ScrollController _scroll = ScrollController();
  SupportRequest? _request;
  List<SupportMessage> _messages = const [];
  StreamSubscription<Map<String, dynamic>>? _events;
  Timer? _reloadTimer;
  bool _loading = true;
  bool _sending = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _request = widget.initialRequest;
    _events = widget.api.customerEvents.listen((event) {
      final type = _asString(event['type']);
      if (type != 'support.updated') return;
      final requestId = _asString(_asMap(event['data'])['requestId']);
      if (requestId != widget.initialRequest.id) return;
      _reloadTimer?.cancel();
      _reloadTimer = Timer(const Duration(milliseconds: 200), () {
        if (mounted) unawaited(_load(silent: true));
      });
    });
    unawaited(_load());
  }

  @override
  void dispose() {
    _reloadTimer?.cancel();
    _events?.cancel();
    _reply.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _applyThread(SupportThread thread) {
    if (!mounted) return;
    setState(() {
      _request = thread.request;
      _messages = thread.messages;
      _error = null;
    });
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !_scroll.hasClients) return;
      _scroll.animateTo(
        _scroll.position.maxScrollExtent,
        duration: BulkaMotion.duration(context, BulkaMotion.standard),
        curve: Curves.easeOutCubic,
      );
    });
  }

  Future<void> _load({bool silent = false}) async {
    if (!silent && mounted) setState(() => _loading = true);
    try {
      _applyThread(await widget.api.getSupportThread(widget.initialRequest.id));
    } catch (error) {
      if (mounted && !silent) {
        setState(() => _error = localizeErrorMessage(error));
      }
    } finally {
      if (mounted && !silent) setState(() => _loading = false);
    }
  }

  Future<void> _send() async {
    final text = _reply.text.trim();
    if (_sending || text.isEmpty) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('support_reply_required'.tr)));
      return;
    }
    final optimisticId =
        'local-${DateTime.now().microsecondsSinceEpoch.toString()}';
    final optimisticMessage = SupportMessage(
      id: optimisticId,
      requestId: widget.initialRequest.id,
      senderType: 'customer',
      body: text,
      attachments: const [],
      createdAt: DateTime.now(),
    );
    setState(() {
      _sending = true;
      _messages = [..._messages, optimisticMessage];
      _reply.clear();
    });
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scroll.hasClients) return;
      _scroll.animateTo(
        _scroll.position.maxScrollExtent,
        duration: BulkaMotion.duration(context, BulkaMotion.fast),
        curve: Curves.easeOut,
      );
    });
    try {
      final thread = await widget.api.sendSupportReply(
        widget.initialRequest.id,
        text,
      );
      _applyThread(thread);
      await BulkaMotion.confirm();
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _messages = [
          for (final message in _messages)
            if (message.id != optimisticId) message,
        ];
        if (_reply.text.trim().isEmpty) _reply.text = text;
      });
      showApiErrorSnackBar(context, error);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final request = _request ?? widget.initialRequest;
    final colors = context.bulkaColors;
    return Scaffold(
      appBar: AppBar(
        toolbarHeight: BulkaLayout.appBarHeight(context),
        title: _BulkaPageTitle('support_conversation'.tr),
      ),
      body: SafeArea(
        top: false,
        child: Column(
          children: [
            Container(
              width: double.infinity,
              padding: const EdgeInsets.fromLTRB(18, 12, 18, 14),
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.surface,
                border: Border(bottom: BorderSide(color: colors.cardBorder)),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'support_category_${request.category}'.tr,
                          style: const TextStyle(
                            fontFamily: _headingFont,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        if (request.orderNumber != null)
                          Text(
                            'order_details_title'.trArgs({
                              'number': request.orderNumber,
                            }),
                            style: TextStyle(
                              color: colors.mutedText,
                              fontSize: BulkaTypeScale.caption,
                            ),
                          ),
                      ],
                    ),
                  ),
                  Text(
                    'support_status_${request.status}'.tr,
                    style: TextStyle(
                      color: colors.brandGold,
                      fontFamily: _headingFont,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
            ),
            Expanded(
              child: _loading
                  ? const Center(child: CircularProgressIndicator())
                  : _error != null && _messages.isEmpty
                  ? _OrderNotice(
                      icon: Icons.cloud_off_rounded,
                      text: _error!,
                      color: colors.danger,
                    )
                  : RefreshIndicator(
                      color: colors.brandGold,
                      onRefresh: _load,
                      child: ListView.separated(
                        controller: _scroll,
                        physics: const AlwaysScrollableScrollPhysics(),
                        padding: const EdgeInsets.fromLTRB(18, 18, 18, 24),
                        itemCount: _messages.length,
                        separatorBuilder: (_, _) => const SizedBox(height: 10),
                        itemBuilder: (context, index) =>
                            _SupportMessageBubble(message: _messages[index]),
                      ),
                    ),
            ),
            DecoratedBox(
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.surface,
                border: Border(top: BorderSide(color: colors.cardBorder)),
              ),
              child: Padding(
                padding: EdgeInsets.fromLTRB(
                  14,
                  10,
                  10,
                  10 + MediaQuery.viewInsetsOf(context).bottom,
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _reply,
                        enabled: !_sending,
                        minLines: 1,
                        maxLines: 5,
                        maxLength: 4000,
                        textCapitalization: TextCapitalization.sentences,
                        decoration: InputDecoration(
                          hintText: 'support_reply_hint'.tr,
                          counterText: '',
                        ),
                        onSubmitted: (_) => unawaited(_send()),
                      ),
                    ),
                    const SizedBox(width: 8),
                    IconButton.filled(
                      onPressed: _sending ? null : _send,
                      tooltip: 'support_send'.tr,
                      icon: _sending
                          ? const SizedBox.square(
                              dimension: 20,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.send_rounded),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SupportMessageBubble extends StatelessWidget {
  const _SupportMessageBubble({required this.message});

  final SupportMessage message;

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    final customer = message.fromCustomer;
    return Align(
      alignment: customer ? Alignment.centerRight : Alignment.centerLeft,
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxWidth: MediaQuery.sizeOf(context).width * .82,
        ),
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: customer
                ? colors.brandGold.withValues(alpha: .18)
                : Theme.of(context).colorScheme.surface,
            borderRadius: BorderRadius.only(
              topLeft: const Radius.circular(BulkaRadii.control),
              topRight: const Radius.circular(BulkaRadii.control),
              bottomLeft: Radius.circular(
                customer ? BulkaRadii.control : BulkaRadii.small,
              ),
              bottomRight: Radius.circular(
                customer ? BulkaRadii.small : BulkaRadii.control,
              ),
            ),
            border: Border.all(color: colors.cardBorder),
          ),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  customer
                      ? 'support_message_customer'.tr
                      : 'support_message_team'.tr,
                  style: TextStyle(
                    color: customer ? colors.brandGold : colors.mutedText,
                    fontFamily: _headingFont,
                    fontSize: BulkaTypeScale.caption,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 4),
                Text(message.body),
                for (final attachment in message.attachments)
                  if (attachment.url?.isNotEmpty == true) ...[
                    const SizedBox(height: 8),
                    ClipRRect(
                      borderRadius: BorderRadius.circular(BulkaRadii.small),
                      child: SizedBox(
                        width: 220,
                        height: 150,
                        child: _NetworkImage(
                          url: attachment.url!,
                          fit: BoxFit.cover,
                          semanticLabel: 'support_photos_count'.trArgs({
                            'count': message.attachments.length,
                          }),
                        ),
                      ),
                    ),
                  ],
                const SizedBox(height: 5),
                Text(
                  MaterialLocalizations.of(context).formatTimeOfDay(
                    TimeOfDay.fromDateTime(message.createdAt.toLocal()),
                  ),
                  style: TextStyle(
                    color: colors.mutedText,
                    fontSize: BulkaTypeScale.caption,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
