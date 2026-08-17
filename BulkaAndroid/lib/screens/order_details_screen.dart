part of '../main.dart';

class OrderDetailsScreen extends StatefulWidget {
  const OrderDetailsScreen({
    required this.api,
    required this.initialOrder,
    required this.onRepeat,
    required this.onReview,
    required this.onOrderChanged,
    super.key,
  });

  final BulkaApiClient api;
  final CustomerOrder initialOrder;
  final Future<void> Function(CustomerOrder order) onRepeat;
  final Future<void> Function(CustomerOrder order) onReview;
  final ValueChanged<CustomerOrder> onOrderChanged;

  @override
  State<OrderDetailsScreen> createState() => _OrderDetailsScreenState();
}

class _OrderDetailsScreenState extends State<OrderDetailsScreen>
    with WidgetsBindingObserver {
  late CustomerOrder _order;
  final YandexMapController _mapController = YandexMapController();
  StreamSubscription<Map<String, dynamic>>? _events;
  Timer? _clock;
  bool _refreshing = false;
  bool _arrivalLoading = false;
  bool _cancellationLoading = false;
  bool _repeatLoading = false;
  bool _reviewLoading = false;
  PickupHandoff? _pickupHandoff;
  Object? _pickupHandoffError;
  bool _pickupHandoffLoading = false;
  DateTime _now = DateTime.now();

  @override
  void initState() {
    super.initState();
    _order = widget.initialOrder;
    WidgetsBinding.instance.addObserver(this);
    _events = widget.api.customerEvents.listen((event) {
      final type = _asString(event['type']);
      final data = _asMap(event['data']);
      if ((type.startsWith('order.') || type.startsWith('delivery.')) &&
          (data['orderId'] == null ||
              _asString(data['orderId']) == _order.id)) {
        unawaited(_reload());
      }
    });
    _clock = Timer.periodic(const Duration(seconds: 15), (_) {
      if (!mounted) return;
      setState(() => _now = DateTime.now());
      // SSE normally delivers the update immediately. This bounded fallback
      // keeps the courier marker moving when iOS suspends/reconnects the
      // EventSource or a network transition drops one event.
      unawaited(_reload());
    });
    unawaited(_loadPickupHandoff());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _events?.cancel();
    _clock?.cancel();
    _mapController.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) unawaited(_reload());
  }

  Future<void> _reload() async {
    if (_refreshing) return;
    _refreshing = true;
    try {
      final pages = await Future.wait([
        widget.api.getCustomerOrders(),
        widget.api.getCustomerOrders(completed: true),
      ]);
      final orders = pages.expand((page) => page);
      final updated = orders.where((item) => item.id == _order.id).firstOrNull;
      if (updated != null && mounted) {
        setState(() {
          _order = updated;
          _now = DateTime.now();
        });
        widget.onOrderChanged(updated);
        unawaited(_loadPickupHandoff(silent: true));
      }
    } catch (_) {
      // Keep the last realtime snapshot visible while the connection recovers.
    } finally {
      _refreshing = false;
    }
  }

  bool get _canHavePickupHandoff =>
      !_order.usesDelivery &&
      _order.paymentStatus == 'paid' &&
      !_order.isClosed;

  Future<void> _loadPickupHandoff({bool silent = false}) async {
    if (!_canHavePickupHandoff) {
      if (mounted && (_pickupHandoff != null || _pickupHandoffError != null)) {
        setState(() {
          _pickupHandoff = null;
          _pickupHandoffError = null;
          _pickupHandoffLoading = false;
        });
      }
      return;
    }
    if (_pickupHandoffLoading) return;
    if (mounted && !silent) {
      setState(() {
        _pickupHandoffLoading = true;
        _pickupHandoffError = null;
      });
    } else {
      _pickupHandoffLoading = true;
    }
    try {
      final handoff = await widget.api.getPickupHandoff(_order.id);
      if (mounted) {
        setState(() {
          _pickupHandoff = handoff;
          _pickupHandoffError = null;
        });
      }
    } catch (error) {
      if (mounted) setState(() => _pickupHandoffError = error);
    } finally {
      if (mounted) setState(() => _pickupHandoffLoading = false);
    }
  }

  Future<void> _callCourier() async {
    final phone = _order.courier?.phone.trim() ?? '';
    if (phone.isEmpty) return;
    final opened = await launchUrl(Uri(scheme: 'tel', path: phone));
    if (!opened && mounted) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('order_call_unavailable'.tr)));
    }
  }

  Future<void> _openExternalMap() async {
    final courier = _order.courier;
    if (courier?.latitude == null || courier?.longitude == null) return;
    await launchUrl(
      Uri.parse(
        'https://yandex.kz/maps/?pt=${courier!.longitude},${courier.latitude}&z=16&l=map',
      ),
      mode: LaunchMode.externalApplication,
    );
  }

  Future<void> _openDeliveryTracking() async {
    final value = _order.trackingUrl?.trim() ?? '';
    final url = Uri.tryParse(value);
    if (url == null || !url.hasScheme) return;
    await launchUrl(url, mode: LaunchMode.externalApplication);
  }

  Future<void> _openReceipt() async {
    final url = Uri.tryParse(_order.receiptUrl?.trim() ?? '');
    if (url == null || !url.hasScheme) return;
    final opened = await launchUrl(url, mode: LaunchMode.externalApplication);
    if (!opened && mounted) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('order_receipt_open_error'.tr)));
    }
  }

  Future<void> _markArrived() async {
    if (_arrivalLoading) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text('orders_arrival_confirm_title'.tr),
        content: Text(
          'orders_arrival_confirm_body'.trArgs({'number': _order.number}),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: Text('cancel_btn'.tr),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: Text('orders_arrival_send'.tr),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => _arrivalLoading = true);
    try {
      final updated = await widget.api.markCustomerArrived(_order.id);
      if (!mounted) return;
      setState(() => _order = updated);
      widget.onOrderChanged(updated);
      await BulkaMotion.confirm();
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('orders_arrival_sent'.tr)));
      }
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(localizeErrorMessage(error))));
    } finally {
      if (mounted) setState(() => _arrivalLoading = false);
    }
  }

  Future<void> _cancelOrder() async {
    if (_cancellationLoading || !_order.canCancel) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text('order_cancel_title'.tr),
        content: Text('order_cancel_body'.tr),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: Text('cancel_btn'.tr),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            style: FilledButton.styleFrom(backgroundColor: _errorRed),
            child: Text('order_cancel_confirm'.tr),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => _cancellationLoading = true);
    try {
      final updated = await widget.api.cancelCustomerOrder(_order.id);
      if (!mounted) return;
      setState(() => _order = updated);
      widget.onOrderChanged(updated);
      await BulkaMotion.confirm();
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('order_cancel_success'.tr)));
      }
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            localizeErrorMessage(error, fallbackKey: 'order_cancel_error'),
          ),
        ),
      );
      await _reload();
    } finally {
      if (mounted) setState(() => _cancellationLoading = false);
    }
  }

  Future<void> _repeatOrder() async {
    if (_repeatLoading) return;
    setState(() => _repeatLoading = true);
    try {
      await widget.onRepeat(_order);
    } finally {
      if (mounted) setState(() => _repeatLoading = false);
    }
  }

  Future<void> _reviewOrder() async {
    if (_reviewLoading) return;
    setState(() => _reviewLoading = true);
    try {
      await widget.onReview(_order);
    } finally {
      if (mounted) setState(() => _reviewLoading = false);
    }
  }

  bool get _canReportArrival =>
      _order.paymentStatus == 'paid' &&
      !_order.usesDelivery &&
      _order.orderStatus == 'ready';

  String _formatDateTime(DateTime value) {
    return formatUiDateTime(context, value);
  }

  String _clockLabel(DateTime value) {
    return formatUiTime(context, value);
  }

  String get _etaConfidenceText {
    final confidence = _order.etaConfidence;
    if (!const {'low', 'medium', 'high'}.contains(confidence)) return '';
    return 'order_eta_confidence_$confidence'.tr;
  }

  String get _etaText {
    final minimum = _order.etaMinAt?.toLocal();
    final maximum = _order.etaMaxAt?.toLocal();
    if (minimum != null && maximum != null) {
      final maximumDifference = maximum.difference(_now);
      if (maximumDifference.isNegative) {
        return _order.orderStatus == 'ready' || _order.isClosed
            ? 'order_eta_ready'.tr
            : 'order_eta_clarifying'.tr;
      }
      final minimumMinutes = max(1, minimum.difference(_now).inMinutes);
      final maximumMinutes = max(minimumMinutes, maximumDifference.inMinutes);
      final remaining = maximumMinutes <= 180
          ? 'order_eta_range_minutes'.trArgs({
              'min': minimumMinutes,
              'max': maximumMinutes,
            })
          : 'order_eta_window'.trArgs({
              'min': _formatDateTime(minimum),
              'max': _formatDateTime(maximum),
            });
      if (maximumMinutes > 180) return remaining;
      return '$remaining · ${_clockLabel(minimum)}–${_clockLabel(maximum)}';
    }
    final eta = _order.eta;
    if (eta == null) {
      final minutes = _order.preparationMinutes;
      return minutes == null
          ? 'order_eta_calculating'.tr
          : 'order_eta_minutes'.trArgs({'minutes': minutes});
    }
    final difference = eta.toLocal().difference(_now);
    if (difference.isNegative) {
      return _order.orderStatus == 'ready' || _order.isClosed
          ? 'order_eta_ready'.tr
          : 'order_eta_clarifying'.tr;
    }
    final totalMinutes = max(1, difference.inMinutes);
    final hours = totalMinutes ~/ 60;
    final minutes = totalMinutes % 60;
    final remaining = hours > 0
        ? 'order_eta_hours_minutes'.trArgs({'hours': hours, 'minutes': minutes})
        : 'order_eta_minutes'.trArgs({'minutes': minutes});
    return '$remaining · ${_formatDateTime(eta)}';
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final colors = context.bulkaColors;
    final courier = _order.courier;
    final hasCourierPoint =
        courier?.latitude != null && courier?.longitude != null;
    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      appBar: AppBar(
        toolbarHeight: BulkaLayout.appBarHeight(context),
        title: _BulkaPageTitle(
          'order_details_title'.trArgs({'number': _order.number}),
        ),
        actions: [
          SizedBox(
            width: BulkaLayout.appBarSideSlot,
            child: IconButton(
              onPressed: _refreshing ? null : _reload,
              tooltip: 'orders_refresh'.tr,
              icon: _refreshing
                  ? const SizedBox.square(
                      dimension: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.refresh_rounded),
            ),
          ),
        ],
      ),
      body: RefreshIndicator(
        color: colors.brandGold,
        onRefresh: _reload,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(18, 12, 18, 36),
          children: [
            Semantics(
              liveRegion: true,
              label:
                  '${'order_current_status'.tr}: ${'order_status_${_order.orderStatus}'.tr}. ${'orders_eta'.tr}: $_etaText. $_etaConfidenceText',
              child: Container(
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: const [Color(0xFF6D3317), Color(0xFF3F1D0E)],
                  ),
                  borderRadius: BorderRadius.circular(BulkaRadii.card),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'order_status_${_order.orderStatus}'.tr,
                      style: const TextStyle(
                        fontFamily: _headingFont,
                        color: Colors.white,
                        fontSize: BulkaTypeScale.titleLarge,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      _etaText,
                      style: const TextStyle(
                        fontFamily: _headingFont,
                        color: Color(0xFFFFD36A),
                        fontSize: BulkaTypeScale.body,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    if (_etaConfidenceText.isNotEmpty) ...[
                      const SizedBox(height: 4),
                      Text(
                        _etaConfidenceText,
                        style: const TextStyle(
                          color: Color(0xFFEBDDD5),
                          fontSize: BulkaTypeScale.caption,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                    const SizedBox(height: 6),
                    Text(
                      _order.branch,
                      style: const TextStyle(color: Color(0xFFEBDDD5)),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),
            _OrderTimeline(order: _order),
            if (_canHavePickupHandoff &&
                (_order.orderStatus == 'ready' || _pickupHandoff != null)) ...[
              const SizedBox(height: 16),
              _buildPickupHandoff(),
            ],
            if (_order.refundStatus?.isNotEmpty == true ||
                _order.paymentStatus == 'refunded') ...[
              const SizedBox(height: 16),
              _RefundProgressCard(order: _order),
            ],
            if (_order.trackingUrl?.isNotEmpty == true) ...[
              const SizedBox(height: 16),
              SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  onPressed: _openDeliveryTracking,
                  icon: const Icon(Icons.delivery_dining_rounded),
                  label: Text('orders_track_yandex'.tr),
                ),
              ),
            ],
            if (hasCourierPoint) ...[
              const SizedBox(height: 16),
              _OrderSection(
                title: 'order_courier_live'.tr,
                child: Column(
                  children: [
                    ClipRRect(
                      borderRadius: BorderRadius.circular(BulkaRadii.control),
                      child: SizedBox(
                        height: 220,
                        child: YandexMapView(
                          controller: _mapController,
                          center: LatLng(
                            courier!.latitude!,
                            courier.longitude!,
                          ),
                          selectedPoint: LatLng(
                            courier.latitude!,
                            courier.longitude!,
                          ),
                          zoom: 15,
                          branches: const [],
                          semanticLabel: 'map_delivery_zones_title'.tr,
                          unavailableLabel: 'map_unavailable'.tr,
                          interactive: false,
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        Expanded(
                          child: FilledButton.icon(
                            onPressed: courier.phone.trim().isEmpty
                                ? null
                                : _callCourier,
                            icon: const Icon(Icons.call_rounded),
                            label: Text('order_call_courier'.tr),
                          ),
                        ),
                        const SizedBox(width: 10),
                        IconButton.outlined(
                          onPressed: _openExternalMap,
                          tooltip: 'orders_courier_map'.tr,
                          icon: const Icon(Icons.open_in_new_rounded),
                        ),
                      ],
                    ),
                    if (courier.locationUpdatedAt != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 8),
                        child: Text(
                          'order_location_updated'.trArgs({
                            'time': _formatDateTime(courier.locationUpdatedAt!),
                          }),
                          style: TextStyle(
                            color: colors.mutedText,
                            fontSize: BulkaTypeScale.caption,
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ],
            if (_order.deliveryPin?.isNotEmpty == true) ...[
              const SizedBox(height: 16),
              _OrderSection(
                title: 'orders_delivery_pin'.tr,
                child: SelectableText(
                  _order.deliveryPin!,
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontFamily: _headingFont,
                    color: scheme.onSurface,
                    fontSize: BulkaTypeScale.display,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 8,
                  ),
                ),
              ),
            ],
            const SizedBox(height: 16),
            _OrderSection(
              title: 'order_items_title'.tr,
              child: Column(
                children: [
                  for (final item in _order.items)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 7),
                      child: Row(
                        children: [
                          Expanded(child: Text(_asString(item['name']))),
                          Text(
                            '× ${_asInt(item['quantity'], fallback: 1)}',
                            style: const TextStyle(
                              fontFamily: _headingFont,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ],
                      ),
                    ),
                  const Divider(height: 24),
                  _OrderInfoRow(
                    label: 'orders_total'.tr,
                    value: '${_formatCartMoney(_order.amount)} ₸',
                    strong: true,
                  ),
                ],
              ),
            ),
            if (_canReportArrival) ...[
              const SizedBox(height: 16),
              if (_order.customerArrivedAt != null)
                _OrderNotice(
                  icon: Icons.check_circle_rounded,
                  text: 'orders_arrival_sent'.tr,
                  color: colors.success,
                )
              else
                SizedBox(
                  height: 54,
                  child: FilledButton.icon(
                    onPressed: _arrivalLoading ? null : _markArrived,
                    icon: _arrivalLoading
                        ? const SizedBox.square(
                            dimension: 20,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.near_me_rounded),
                    label: Text('orders_i_arrived'.tr),
                  ),
                ),
            ],
            const SizedBox(height: 16),
            if (_order.receiptUrl?.isNotEmpty == true) ...[
              OutlinedButton.icon(
                onPressed: _openReceipt,
                icon: const Icon(Icons.receipt_long_rounded),
                label: Text('order_receipt'.tr),
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size.fromHeight(52),
                ),
              ),
              const SizedBox(height: 10),
            ],
            if (_order.canCancel) ...[
              OutlinedButton.icon(
                onPressed: _cancellationLoading ? null : _cancelOrder,
                icon: _cancellationLoading
                    ? const SizedBox.square(
                        dimension: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.cancel_outlined),
                label: Text('order_cancel_action'.tr),
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size.fromHeight(52),
                  foregroundColor: _errorRed,
                  side: const BorderSide(color: _errorRed),
                ),
              ),
              const SizedBox(height: 10),
            ],
            OutlinedButton.icon(
              onPressed: () => Navigator.of(context).push<void>(
                MaterialPageRoute(
                  builder: (_) =>
                      OrderSupportScreen(api: widget.api, initialOrder: _order),
                ),
              ),
              icon: const Icon(Icons.support_agent_rounded),
              label: Text('order_support'.tr),
              style: OutlinedButton.styleFrom(
                minimumSize: const Size.fromHeight(52),
              ),
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _repeatLoading ? null : _repeatOrder,
                    icon: _repeatLoading
                        ? const SizedBox.square(
                            dimension: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.replay_rounded),
                    label: Text('order_repeat'.tr),
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size.fromHeight(52),
                    ),
                  ),
                ),
                if (_order.isClosed) ...[
                  const SizedBox(width: 10),
                  Expanded(
                    child: FilledButton.icon(
                      onPressed: _reviewLoading ? null : _reviewOrder,
                      icon: _reviewLoading
                          ? const SizedBox.square(
                              dimension: 18,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.star_outline_rounded),
                      label: Text('order_review'.tr),
                      style: FilledButton.styleFrom(
                        minimumSize: const Size.fromHeight(52),
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildPickupHandoff() {
    final handoff = _pickupHandoff;
    if (_pickupHandoffLoading && handoff == null) {
      return _OrderSection(
        title: 'pickup_handoff_title'.tr,
        child: const Center(
          child: SizedBox.square(
            dimension: 28,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
        ),
      );
    }
    if (handoff == null) {
      return _OrderSection(
        title: 'pickup_handoff_title'.tr,
        child: Column(
          children: [
            Text('pickup_handoff_load_error'.tr, textAlign: TextAlign.center),
            const SizedBox(height: 10),
            OutlinedButton.icon(
              onPressed: _pickupHandoffLoading ? null : _loadPickupHandoff,
              icon: const Icon(Icons.refresh_rounded),
              label: Text('retry_btn'.tr),
              style: OutlinedButton.styleFrom(
                minimumSize: const Size.fromHeight(48),
              ),
            ),
          ],
        ),
      );
    }
    if (handoff.isUsed || handoff.isExpired) {
      return _OrderNotice(
        icon: handoff.isUsed
            ? Icons.check_circle_rounded
            : Icons.schedule_rounded,
        text: handoff.isUsed
            ? 'pickup_handoff_used'.tr
            : 'pickup_handoff_expired'.tr,
        color: handoff.isUsed
            ? context.bulkaColors.success
            : context.bulkaColors.warning,
      );
    }
    final pinLabel = 'pickup_handoff_pin'.trArgs({'pin': handoff.pin});
    return _OrderSection(
      title: 'pickup_handoff_title'.tr,
      child: Column(
        children: [
          Text('pickup_handoff_hint'.tr, textAlign: TextAlign.center),
          const SizedBox(height: 14),
          Semantics(
            image: true,
            label: '${'pickup_handoff_title'.tr}. $pinLabel',
            excludeSemantics: true,
            child: Center(
              child: QrImageView(
                data: handoff.qrPayload,
                size: 190,
                backgroundColor: Colors.white,
                errorCorrectionLevel: QrErrorCorrectLevel.H,
              ),
            ),
          ),
          const SizedBox(height: 12),
          Semantics(
            label: pinLabel,
            child: SelectableText(
              handoff.pin,
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontFamily: _headingFont,
                fontSize: BulkaTypeScale.display,
                fontWeight: FontWeight.w700,
                letterSpacing: 8,
                fontFeatures: [FontFeature.tabularFigures()],
              ),
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'pickup_handoff_expires'.trArgs({
              'time': formatUiDateTime(context, handoff.expiresAt.toLocal()),
            }),
            style: TextStyle(
              color: context.bulkaColors.mutedText,
              fontSize: BulkaTypeScale.caption,
            ),
          ),
        ],
      ),
    );
  }
}

class _OrderSection extends StatelessWidget {
  const _OrderSection({required this.title, required this.child});

  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        borderRadius: BorderRadius.circular(BulkaRadii.card),
        border: Border.all(color: colors.cardBorder),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: const TextStyle(
              fontFamily: _headingFont,
              fontSize: BulkaTypeScale.titleSmall,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 14),
          child,
        ],
      ),
    );
  }
}

class _OrderNotice extends StatelessWidget {
  const _OrderNotice({
    required this.icon,
    required this.text,
    required this.color,
  });

  final IconData icon;
  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) => Semantics(
    liveRegion: true,
    label: text,
    child: Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: color.withValues(alpha: .12),
        borderRadius: BorderRadius.circular(BulkaRadii.control),
        border: Border.all(color: color.withValues(alpha: .42)),
      ),
      child: Row(
        children: [
          Icon(icon, color: color),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              text,
              style: const TextStyle(
                fontFamily: _headingFont,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
    ),
  );
}

class _OrderTimeline extends StatelessWidget {
  const _OrderTimeline({required this.order});

  final CustomerOrder order;

  List<({String key, IconData icon})> get _steps => [
    (key: 'new', icon: Icons.receipt_long_rounded),
    (key: 'accepted', icon: Icons.thumb_up_alt_rounded),
    (key: 'preparing', icon: Icons.bakery_dining_rounded),
    (key: 'ready', icon: Icons.inventory_2_rounded),
    if (order.usesDelivery)
      (key: 'en_route', icon: Icons.delivery_dining_rounded),
    (key: 'completed', icon: Icons.check_circle_rounded),
  ];

  int get _activeIndex {
    if (order.orderStatus == 'cancelled') return -1;
    final base = switch (order.orderStatus) {
      'accepted' => 1,
      'preparing' => 2,
      'ready' => 3,
      'completed' => _steps.length - 1,
      _ => 0,
    };
    if (order.usesDelivery) {
      if (const {'picked_up', 'en_route'}.contains(order.deliveryStatus)) {
        return _steps.length - 2;
      }
      if (order.deliveryStatus == 'delivered') return _steps.length - 1;
    }
    return base;
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    if (order.orderStatus == 'cancelled') {
      return _OrderNotice(
        icon: Icons.cancel_rounded,
        text: 'order_status_cancelled'.tr,
        color: colors.danger,
      );
    }
    final active = _activeIndex;
    return _OrderSection(
      title: 'order_timeline_title'.tr,
      child: Column(
        children: [
          for (var index = 0; index < _steps.length; index++)
            _TimelineStep(
              icon: _steps[index].icon,
              label: 'order_timeline_${_steps[index].key}'.tr,
              completed: index <= active,
              current: index == active,
              last: index == _steps.length - 1,
            ),
        ],
      ),
    );
  }
}

class _TimelineStep extends StatelessWidget {
  const _TimelineStep({
    required this.icon,
    required this.label,
    required this.completed,
    required this.current,
    required this.last,
  });

  final IconData icon;
  final String label;
  final bool completed;
  final bool current;
  final bool last;

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    final color = completed ? colors.success : colors.cardBorder;
    return Semantics(
      label: label,
      value: current
          ? 'order_timeline_current'.tr
          : completed
          ? 'order_timeline_done'.tr
          : 'order_timeline_waiting'.tr,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Column(
            children: [
              AnimatedContainer(
                duration: BulkaMotion.duration(context, BulkaMotion.fast),
                width: 36,
                height: 36,
                decoration: BoxDecoration(color: color, shape: BoxShape.circle),
                child: Icon(
                  completed ? Icons.check_rounded : icon,
                  color: completed
                      ? Colors.white
                      : Theme.of(context).colorScheme.onSurfaceVariant,
                  size: 20,
                ),
              ),
              if (!last) Container(width: 3, height: 28, color: color),
            ],
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.only(top: 7),
              child: Text(
                label,
                style: TextStyle(
                  fontWeight: current ? FontWeight.w700 : FontWeight.w600,
                  color: completed
                      ? Theme.of(context).colorScheme.onSurface
                      : colors.mutedText,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
