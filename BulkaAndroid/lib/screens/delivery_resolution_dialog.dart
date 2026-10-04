part of '../main.dart';

enum _DeliveryChoiceStep { choice, pickup, cancel }

class DeliveryResolutionDialog extends StatefulWidget {
  const DeliveryResolutionDialog({
    required this.api,
    required this.order,
    super.key,
  });
  final BulkaApiClient api;
  final ValueListenable<CustomerOrder?> order;
  @override
  State<DeliveryResolutionDialog> createState() =>
      _DeliveryResolutionDialogState();
}

class _DeliveryResolutionDialogState extends State<DeliveryResolutionDialog> {
  var _step = _DeliveryChoiceStep.choice;
  DeliveryResolutionOptions? _options;
  DateTime? _pickupTime;
  String? _error;
  bool _loading = false;
  bool _saving = false;
  bool _closing = false;
  int _revision = 0;

  @override
  void initState() {
    super.initState();
    widget.order.addListener(_orderChanged);
    unawaited(_load());
  }

  @override
  void dispose() {
    _revision++;
    widget.order.removeListener(_orderChanged);
    super.dispose();
  }

  void _orderChanged() {
    final order = widget.order.value;
    if (order?.needsDeliveryDecision != true) {
      _finish(order);
    } else if (mounted) {
      setState(() {});
      if (_step == _DeliveryChoiceStep.pickup) {
        unawaited(_load());
      }
    }
  }

  void _finish(CustomerOrder? order) {
    if (_closing || !mounted) return;
    _closing = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) Navigator.of(context).pop(order);
    });
  }

  Future<void> _load() async {
    final order = widget.order.value;
    if (order == null || _saving || _loading || _closing) return;
    final revision = ++_revision;
    setState(() {
      _loading = true;
      _error = null;
      _options = null;
    });
    try {
      final response = await widget.api.getDeliveryResolution(order.id);
      if (!mounted || revision != _revision || _closing) return;
      if (!response.order.needsDeliveryDecision) {
        _finish(response.order);
        return;
      }
      setState(() {
        _options = response.options;
        if (_options?.slots.any((slot) => slot.startsAt == _pickupTime) !=
            true) {
          _pickupTime = null;
        }
      });
    } catch (error) {
      if (mounted && revision == _revision && !_closing) {
        setState(
          () => _error = localizeErrorMessage(
            error,
            fallbackKey: 'delivery_choice_load_error',
          ),
        );
      }
    } finally {
      if (mounted && revision == _revision) setState(() => _loading = false);
    }
  }

  Future<void> _save(String action) async {
    final order = widget.order.value;
    if (_saving ||
        order?.needsDeliveryDecision != true ||
        (action == 'pickup' && _pickupTime == null)) {
      return;
    }
    _revision++;
    setState(() {
      // Submitting invalidates the outstanding options request. Its finally
      // block must not own the loading flag after that invalidation.
      _loading = false;
      _saving = true;
      _error = null;
    });
    try {
      final updated = await widget.api.resolveDelivery(
        order!.id,
        action: action,
        pickupTime: action == 'pickup' ? _pickupTime : null,
      );
      if (!mounted || _closing) return;
      _finish(updated);
    } catch (error) {
      if (!mounted || _closing) return;
      setState(
        () => _error = localizeErrorMessage(
          error,
          fallbackKey: 'delivery_choice_error',
        ),
      );
      // A courier or another device may have resolved the choice during submit.
      try {
        final updated = await widget.api.getCustomerOrder(order!.id);
        if (!mounted || _closing) return;
        if (!updated.needsDeliveryDecision) {
          _finish(updated);
          return;
        }
      } catch (_) {}
      if (action == 'pickup' && mounted && !_closing) {
        setState(() {
          _pickupTime = null;
          _options = null;
        });
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Widget _button(
    String key,
    String label,
    VoidCallback? onPressed, {
    bool destructive = false,
  }) => FilledButton(
    key: ValueKey(key),
    autofocus: true,
    onPressed: _saving ? null : onPressed,
    style: FilledButton.styleFrom(
      minimumSize: const Size.fromHeight(52),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 14),
      textStyle: const TextStyle(
        fontFamily: _headingFont,
        fontSize: BulkaTypeScale.bodySmall,
        fontWeight: FontWeight.w700,
      ),
      backgroundColor: destructive ? _errorRed : null,
      foregroundColor: destructive ? Colors.white : null,
    ),
    child: _saving
        ? const SizedBox.square(
            dimension: 22,
            child: CircularProgressIndicator(strokeWidth: 2),
          )
        : _DeliveryResolutionWords(label, horizontalInset: 16),
  );

  Widget _pickupOptions(BuildContext context) {
    final options = _options;
    final colors = context.bulkaColors;
    final offset = options?.timezoneOffsetMinutes ?? 300;
    final offsetHours = offset.abs() ~/ 60;
    final offsetMinutes = (offset.abs() % 60).toString().padLeft(2, '0');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (options != null) ...[
          _DeliveryResolutionWords(
            options.branchName,
            alignment: WrapAlignment.start,
            style: const TextStyle(
              fontWeight: FontWeight.w700,
              fontSize: BulkaTypeScale.body,
            ),
          ),
          if (options.branchAddress.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(options.branchAddress),
          ],
          const SizedBox(height: 16),
        ],
        Text(
          'delivery_choice_time'.tr,
          style: const TextStyle(fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 6),
        if (_loading)
          const Center(
            child: Padding(
              padding: EdgeInsets.all(20),
              child: CircularProgressIndicator(),
            ),
          )
        else if (options == null || options.slots.isEmpty)
          Text('delivery_choice_empty'.tr)
        else ...[
          Text(
            'delivery_choice_time_zone'.trArgs({
              'offset': '${offset < 0 ? '-' : '+'}$offsetHours:$offsetMinutes',
            }),
            style: TextStyle(
              color: colors.mutedText,
              fontSize: BulkaTypeScale.bodySmall,
            ),
          ),
          const SizedBox(height: 10),
          SizedBox(
            height: min(
              240.0,
              min(
                MediaQuery.sizeOf(context).height * .3,
                options.slots.length *
                    64.0 *
                    max(1.0, MediaQuery.textScalerOf(context).scale(1)),
              ),
            ),
            child: ListView.separated(
              key: const ValueKey('delivery-resolution-slots'),
              itemCount: options.slots.length,
              separatorBuilder: (_, _) => const SizedBox(height: 8),
              itemBuilder: (context, index) {
                final slot = options.slots[index];
                final selected = slot.startsAt == _pickupTime;
                final start = slot.branchStartsAt;
                final end = slot.branchEndsAt;
                final label =
                    '${start.day.toString().padLeft(2, '0')}.${start.month.toString().padLeft(2, '0')} · '
                    '${formatUiTime(context, start)}–${formatUiTime(context, end)}';
                return Semantics(
                  selected: selected,
                  child: OutlinedButton(
                    key: ValueKey(
                      'delivery-slot-${slot.startsAt.toIso8601String()}',
                    ),
                    onPressed: _saving
                        ? null
                        : () => setState(() => _pickupTime = slot.startsAt),
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size.fromHeight(48),
                      backgroundColor: selected
                          ? colors.brandGold.withValues(alpha: .16)
                          : null,
                      side: BorderSide(
                        color: selected ? colors.brandBrown : colors.cardBorder,
                      ),
                    ),
                    child: Text(label, textAlign: TextAlign.center),
                  ),
                );
              },
            ),
          ),
          const SizedBox(height: 12),
          Text('delivery_choice_approval'.tr),
        ],
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final order = widget.order.value;
    final number = order?.number ?? 0;
    return PopScope(
      canPop: false,
      child: BulkaActionDialog(
        key: const ValueKey('delivery-resolution-dialog'),
        title: _DeliveryResolutionWords(
          (_step == _DeliveryChoiceStep.pickup
                  ? 'delivery_choice_pickup_title'
                  : 'delivery_choice_title')
              .tr,
          style: const TextStyle(
            fontSize: BulkaTypeScale.titleSmall,
            fontWeight: FontWeight.w700,
          ),
        ),
        content: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            if (_step == _DeliveryChoiceStep.pickup)
              _pickupOptions(context)
            else
              Text(
                (_step == _DeliveryChoiceStep.cancel
                        ? 'delivery_choice_cancel_body'
                        : 'delivery_choice_body')
                    .trArgs({'number': number}),
              ),
            if (_error != null) ...[
              const SizedBox(height: 12),
              Semantics(
                liveRegion: true,
                child: Text(
                  _error!,
                  key: const ValueKey('delivery-resolution-error'),
                  style: const TextStyle(color: _errorRed),
                ),
              ),
            ],
          ],
        ),
        actions: [
          if (_step == _DeliveryChoiceStep.choice) ...[
            _button(
              'delivery-resolution-pickup',
              'delivery_choice_pickup'.tr,
              () {
                setState(() => _step = _DeliveryChoiceStep.pickup);
                unawaited(_load());
              },
            ),
            OutlinedButton(
              key: const ValueKey('delivery-resolution-cancel'),
              style: OutlinedButton.styleFrom(
                padding: const EdgeInsets.symmetric(
                  horizontal: 8,
                  vertical: 14,
                ),
                textStyle: const TextStyle(
                  fontFamily: _headingFont,
                  fontSize: BulkaTypeScale.bodySmall,
                  fontWeight: FontWeight.w700,
                ),
              ),
              onPressed: _saving
                  ? null
                  : () => setState(() {
                      _step = _DeliveryChoiceStep.cancel;
                      _error = null;
                    }),
              child: _DeliveryResolutionWords(
                'delivery_choice_cancel'.tr,
                horizontalInset: 16,
              ),
            ),
          ] else ...[
            if (_step == _DeliveryChoiceStep.cancel)
              _button(
                'delivery-resolution-confirm-cancel',
                'delivery_choice_cancel'.tr,
                () => unawaited(_save('cancel')),
                destructive: true,
              )
            else
              _button(
                'delivery-resolution-confirm-pickup',
                'delivery_choice_submit'.tr,
                _pickupTime == null || _loading
                    ? null
                    : () => unawaited(_save('pickup')),
              ),
            if (_step == _DeliveryChoiceStep.pickup &&
                !_loading &&
                (_options == null || _error != null))
              OutlinedButton(
                key: const ValueKey('delivery-resolution-retry'),
                style: OutlinedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 14,
                  ),
                  textStyle: const TextStyle(
                    fontFamily: _headingFont,
                    fontSize: BulkaTypeScale.bodySmall,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                onPressed: _saving ? null : () => unawaited(_load()),
                child: _DeliveryResolutionWords(
                  'retry'.tr,
                  horizontalInset: 16,
                ),
              ),
            TextButton(
              onPressed: _saving
                  ? null
                  : () => setState(() {
                      _step = _DeliveryChoiceStep.choice;
                      _error = null;
                    }),
              child: Text('back_tooltip'.tr),
            ),
          ],
        ],
      ),
    );
  }
}

/// Flutter can emergency-break a single word at large text sizes. Keep words
/// intact and make a rare oversized word scroll locally, with its full label.
class _DeliveryResolutionWords extends StatelessWidget {
  const _DeliveryResolutionWords(
    this.text, {
    this.style,
    this.alignment = WrapAlignment.center,
    this.horizontalInset = 0,
  });
  final String text;
  final TextStyle? style;
  final WrapAlignment alignment;
  final double horizontalInset;

  @override
  Widget build(BuildContext context) {
    final effectiveStyle = DefaultTextStyle.of(context).style.merge(style);
    final direction = Directionality.of(context);
    final scaler = MediaQuery.textScalerOf(context);
    final maximumWidth = max(
      1.0,
      MediaQuery.sizeOf(context).width -
          MediaQuery.paddingOf(context).horizontal -
          128 -
          horizontalInset,
    );
    double width(String value) {
      final painter = TextPainter(
        text: TextSpan(text: value, style: effectiveStyle),
        textDirection: direction,
        textScaler: scaler,
      )..layout();
      final result = painter.width;
      painter.dispose();
      return result;
    }

    return SizedBox(
      width: double.maxFinite,
      child: Semantics(
        label: text,
        excludeSemantics: true,
        child: Wrap(
          alignment: alignment,
          spacing: width(' '),
          children: [
            for (final word in text.split(RegExp(r'\s+')))
              SizedBox(
                width: min(width(word), maximumWidth),
                child: SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Text(word, softWrap: false, style: effectiveStyle),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
