part of '../main.dart';

class _SelectedOrderTypeCard extends StatelessWidget {
  const _SelectedOrderTypeCard({required this.value});

  final _OrderType value;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      container: true,
      label: '${'checkout_order_type'.tr}: ${value.label}',
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(BulkaRadii.control),
          border: Border.all(color: _almond.withValues(alpha: 0.7)),
        ),
        child: Row(
          children: [
            Container(
              width: 52,
              height: 52,
              decoration: BoxDecoration(
                color: _bulkaYellow.withValues(alpha: 0.22),
                borderRadius: BorderRadius.circular(BulkaRadii.control),
              ),
              child: Icon(value.icon, color: _textDark, size: 25),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'checkout_order_type'.tr,
                    style: TextStyle(
                      color: context.bulkaColors.mutedText,
                      fontSize: BulkaTypeScale.caption,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    value.label,
                    style: const TextStyle(
                      fontFamily: _headingFont,
                      color: _textDark,
                      fontSize: BulkaTypeScale.body,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    'checkout_catalog_locked'.tr,
                    style: TextStyle(
                      color: context.bulkaColors.mutedText,
                      fontSize: BulkaTypeScale.caption,
                    ),
                  ),
                ],
              ),
            ),
            const Icon(Icons.check_circle_rounded, color: Color(0xFF2E7D32)),
          ],
        ),
      ),
    );
  }
}

class _PreorderFulfillmentSelector extends StatelessWidget {
  const _PreorderFulfillmentSelector({
    required this.value,
    required this.onChanged,
  });

  final _OrderType value;
  final Future<void> Function(_OrderType value) onChanged;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      container: true,
      label: 'checkout_preorder_method'.tr,
      child: Row(
        children: [
          for (final type in const [
            _OrderType.delivery,
            _OrderType.pickup,
          ]) ...[
            if (type == _OrderType.pickup) const SizedBox(width: 10),
            Expanded(
              child: InkWell(
                key: ValueKey('preorder-fulfillment-${type.wireValue}'),
                onTap: () => onChanged(type),
                borderRadius: BorderRadius.circular(BulkaRadii.control),
                child: AnimatedContainer(
                  duration: BulkaMotion.duration(context, BulkaMotion.fast),
                  constraints: const BoxConstraints(minHeight: 70),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 14,
                    vertical: 12,
                  ),
                  decoration: BoxDecoration(
                    gradient: value == type
                        ? const LinearGradient(
                            colors: [Color(0xFFFFE79A), Color(0xFFFFC447)],
                          )
                        : null,
                    color: value == type ? null : Colors.white,
                    borderRadius: BorderRadius.circular(BulkaRadii.control),
                    border: Border.all(
                      color: value == type
                          ? _bulkaYellow
                          : context.bulkaColors.cardBorder,
                    ),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(type.icon, size: 24, color: _textDark),
                      const SizedBox(width: 8),
                      Flexible(
                        child: Text(
                          type.label,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontFamily: _headingFont,
                            fontSize: BulkaTypeScale.body,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _PreorderScheduleField extends StatelessWidget {
  const _PreorderScheduleField({
    required this.slot,
    required this.onTap,
    this.loading = false,
  });

  final _PickupSlot slot;
  final VoidCallback? onTap;
  final bool loading;

  @override
  Widget build(BuildContext context) {
    final local = slot.startsAt.toLocal();
    final now = slot.serverNow;
    final today = DateTime(now.year, now.month, now.day);
    final day = DateTime(local.year, local.month, local.day);
    final offset = day.difference(today).inDays;
    final relative = offset == 0
        ? 'checkout_today'.tr
        : offset == 1
        ? 'checkout_tomorrow'.tr
        : MaterialLocalizations.of(context).formatShortDate(local);
    final exact =
        '${formatUiDate(context, local)}, ${formatUiTime(context, local)}';
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(BulkaRadii.card),
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 70),
          child: Ink(
            padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: [Color(0xFFFFDA64), Color(0xFFFFB312)],
              ),
              borderRadius: BorderRadius.circular(BulkaRadii.card),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    relative,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontFamily: _headingFont,
                      color: Colors.white,
                      fontSize: BulkaTypeScale.body,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 8,
                  ),
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.82),
                    borderRadius: BorderRadius.circular(BulkaRadii.control),
                  ),
                  child: Text(
                    exact,
                    style: TextStyle(
                      fontFamily: _headingFont,
                      color: _textDark.withValues(alpha: 0.58),
                      fontSize: BulkaTypeScale.bodySmall,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                if (loading)
                  const SizedBox(
                    key: ValueKey('checkout-time-loading'),
                    width: 24,
                    height: 24,
                    child: CircularProgressIndicator(
                      strokeWidth: 2.4,
                      color: Colors.white,
                    ),
                  )
                else
                  const Icon(
                    Icons.calendar_month_outlined,
                    color: Colors.white,
                    size: 27,
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _PreorderCalendarSheet extends StatefulWidget {
  const _PreorderCalendarSheet({required this.slots, this.selected});

  final List<_PickupSlot> slots;
  final DateTime? selected;

  @override
  State<_PreorderCalendarSheet> createState() => _PreorderCalendarSheetState();
}

class _PreorderCalendarSheetState extends State<_PreorderCalendarSheet> {
  late final List<DateTime> _days;
  late DateTime _selected;

  DateTime _day(DateTime value) {
    final local = value.toLocal();
    return DateTime(local.year, local.month, local.day);
  }

  @override
  void initState() {
    super.initState();
    _days = widget.slots.map((slot) => _day(slot.startsAt)).toSet().toList()
      ..sort();
    final requested = widget.selected == null ? null : _day(widget.selected!);
    _selected = requested != null && _days.contains(requested)
        ? requested
        : _days.first;
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final available = _days.toSet();
    return Container(
      height: min(MediaQuery.sizeOf(context).height * 0.82, 700),
      padding: EdgeInsets.fromLTRB(
        20,
        10,
        20,
        18 + BulkaLayout.safeBottomInset(context),
      ),
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(
          top: Radius.circular(BulkaRadii.sheet),
        ),
      ),
      child: Column(
        children: [
          Container(
            width: 44,
            height: 5,
            decoration: BoxDecoration(
              color: _almond,
              borderRadius: BorderRadius.circular(BulkaRadii.small),
            ),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: Text(
                  'checkout_choose_date'.tr,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontFamily: _headingFont,
                    fontSize: BulkaTypeScale.title,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              IconButton(
                onPressed: () => Navigator.pop(context),
                tooltip: 'close_tooltip'.tr,
                icon: const Icon(Icons.close_rounded),
                style: IconButton.styleFrom(
                  backgroundColor: _almond.withValues(alpha: 0.65),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Expanded(
            child: Theme(
              data: theme.copyWith(
                colorScheme: theme.colorScheme.copyWith(
                  primary: const Color(0xFFD2A347),
                  onPrimary: Colors.white,
                  surface: Colors.white,
                ),
                datePickerTheme: const DatePickerThemeData(
                  backgroundColor: Colors.white,
                  surfaceTintColor: Colors.transparent,
                  headerBackgroundColor: Colors.white,
                  dividerColor: Colors.transparent,
                ),
              ),
              child: CalendarDatePicker(
                initialDate: _selected,
                firstDate: _days.first,
                lastDate: _days.last,
                currentDate: widget.slots.first.serverNow,
                selectableDayPredicate: available.contains,
                onDateChanged: (value) => setState(() => _selected = value),
              ),
            ),
          ),
          const Divider(height: 1),
          const SizedBox(height: 18),
          SizedBox(
            width: double.infinity,
            child: GradientButton(
              onPressed: () => Navigator.pop(context, _selected),
              child: Text(
                'continue_btn'.tr,
                style: const TextStyle(
                  fontFamily: _headingFont,
                  color: Colors.white,
                  fontSize: BulkaTypeScale.body,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _CheckoutTimeSheet extends StatefulWidget {
  const _CheckoutTimeSheet({required this.slots, this.selectedValue});

  final List<_PickupSlot> slots;
  final String? selectedValue;

  @override
  State<_CheckoutTimeSheet> createState() => _CheckoutTimeSheetState();
}

class _CheckoutTimeSheetState extends State<_CheckoutTimeSheet> {
  late int _index;
  late final FixedExtentScrollController _controller;

  @override
  void initState() {
    super.initState();
    final selected = widget.slots.indexWhere(
      (slot) => slot.value == widget.selectedValue,
    );
    _index = selected < 0 ? 0 : selected;
    _controller = FixedExtentScrollController(initialItem: _index);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      height: min(MediaQuery.sizeOf(context).height * 0.68, 570),
      padding: EdgeInsets.fromLTRB(
        16,
        12,
        16,
        18 + BulkaLayout.safeBottomInset(context),
      ),
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(
          top: Radius.circular(BulkaRadii.sheet),
        ),
      ),
      child: Column(
        children: [
          Container(
            width: 44,
            height: 5,
            decoration: BoxDecoration(
              color: _almond,
              borderRadius: BorderRadius.circular(BulkaRadii.small),
            ),
          ),
          const SizedBox(height: 18),
          Text(
            'checkout_choose_time'.tr,
            style: const TextStyle(
              fontFamily: _headingFont,
              fontSize: BulkaTypeScale.title,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 14),
          Expanded(
            child: ListWheelScrollView.useDelegate(
              controller: _controller,
              itemExtent: 64,
              diameterRatio: 2.4,
              perspective: 0.002,
              physics: const FixedExtentScrollPhysics(),
              onSelectedItemChanged: (index) => setState(() => _index = index),
              childDelegate: ListWheelChildBuilderDelegate(
                childCount: widget.slots.length,
                builder: (context, index) {
                  final selected = index == _index;
                  final slot = widget.slots[index];
                  final start = slot.startsAt.toLocal();
                  final end = slot.endsAt.toLocal();
                  return AnimatedContainer(
                    duration: BulkaMotion.duration(context, BulkaMotion.fast),
                    alignment: Alignment.center,
                    margin: const EdgeInsets.symmetric(horizontal: 4),
                    decoration: BoxDecoration(
                      color: selected
                          ? const Color(0xFFF2F2F4)
                          : Colors.transparent,
                      borderRadius: BorderRadius.circular(BulkaRadii.control),
                    ),
                    child: Text(
                      '${formatUiTime(context, start)}–${formatUiTime(context, end)}',
                      style: TextStyle(
                        color: selected
                            ? _textDark
                            : _textDark.withValues(alpha: 0.28),
                        fontSize: selected ? 20 : 17,
                        fontWeight: selected
                            ? FontWeight.w700
                            : FontWeight.w500,
                      ),
                    ),
                  );
                },
              ),
            ),
          ),
          const Divider(height: 1),
          const SizedBox(height: 18),
          SizedBox(
            width: double.infinity,
            child: GradientButton(
              onPressed: () => Navigator.pop(context, widget.slots[_index]),
              child: Text(
                'continue_btn'.tr,
                style: const TextStyle(
                  fontFamily: _headingFont,
                  color: Colors.white,
                  fontSize: BulkaTypeScale.body,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _CheckoutLabel extends StatelessWidget {
  const _CheckoutLabel(this.text, {this.required = false});

  final String text;
  final bool required;

  @override
  Widget build(BuildContext context) {
    return Text.rich(
      TextSpan(
        text: text,
        children: [
          if (required)
            const TextSpan(
              text: ' *',
              style: TextStyle(color: _errorRed, fontFamily: _descriptionFont),
            ),
        ],
      ),
      style: const TextStyle(
        fontFamily: _headingFont,
        fontSize: BulkaTypeScale.body,
        fontWeight: FontWeight.w700,
      ),
    );
  }
}

class _CheckoutField extends StatelessWidget {
  const _CheckoutField({
    required this.label,
    required this.icon,
    required this.onTap,
    this.loading = false,
  });

  final String label;
  final IconData icon;
  final VoidCallback? onTap;
  final bool loading;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(BulkaRadii.control),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(BulkaRadii.control),
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 62),
          child: Ink(
            padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(BulkaRadii.control),
              border: Border.all(color: context.bulkaColors.cardBorder),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    label,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: BulkaTypeScale.body),
                  ),
                ),
                const SizedBox(width: 12),
                if (loading)
                  const SizedBox(
                    key: ValueKey('checkout-field-loading'),
                    width: 22,
                    height: 22,
                    child: CircularProgressIndicator(strokeWidth: 2.2),
                  )
                else
                  Icon(icon, color: _textDark.withValues(alpha: 0.72)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _CheckoutTotalRow extends StatelessWidget {
  const _CheckoutTotalRow({
    required this.label,
    required this.value,
    this.emphasized = false,
  });

  final String label;
  final String value;
  final bool emphasized;

  @override
  Widget build(BuildContext context) {
    final style = TextStyle(
      fontSize: emphasized ? 18 : 16,
      fontWeight: emphasized ? FontWeight.w700 : FontWeight.w500,
    );
    return Row(
      children: [
        Expanded(child: Text(label, maxLines: 1, style: style)),
        const SizedBox(width: 12),
        Text(value, maxLines: 1, style: style),
      ],
    );
  }
}
