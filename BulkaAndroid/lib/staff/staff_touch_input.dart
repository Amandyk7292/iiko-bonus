part of '../main.dart';

/// An explicit display/input preference; access still comes from the session.
bool isStaffDesktopUri(Uri uri) =>
    uri.queryParameters['desktop'] == '1' ||
    uri.queryParameters['kiosk'] == '1';

class StaffDesktopScope extends InheritedWidget {
  const StaffDesktopScope({
    required this.enabled,
    required super.child,
    super.key,
  });

  final bool enabled;

  static bool enabledOf(BuildContext context) =>
      context
          .dependOnInheritedWidgetOfExactType<StaffDesktopScope>()
          ?.enabled ??
      false;

  @override
  bool updateShouldNotify(StaffDesktopScope oldWidget) =>
      enabled != oldWidget.enabled;
}

/// Keeps the platform keyboard on mobile. In the cashier desktop window,
/// numbers use an inline pad and text is edited in a touch keyboard dialog.
class StaffTouchField extends StatefulWidget {
  const StaffTouchField({
    this.controller,
    this.decoration = const InputDecoration(),
    this.enabled = true,
    this.autofocus = false,
    this.obscureText = false,
    this.autocorrect = true,
    this.enableSuggestions = true,
    this.keyboardType,
    this.textInputAction,
    this.inputFormatters,
    this.autofillHints,
    this.onChanged,
    this.onSubmitted,
    this.onTapOutside,
    this.validator,
    this.minLines,
    this.maxLines = 1,
    this.maxLength,
    this.inlineNumericPad = false,
    this.fieldKey,
    super.key,
  });

  final TextEditingController? controller;
  final InputDecoration decoration;
  final bool enabled, autofocus, obscureText, autocorrect, enableSuggestions;
  final TextInputType? keyboardType;
  final TextInputAction? textInputAction;
  final List<TextInputFormatter>? inputFormatters;
  final Iterable<String>? autofillHints;
  final ValueChanged<String>? onChanged, onSubmitted;
  final TapRegionCallback? onTapOutside;
  final FormFieldValidator<String>? validator;
  final int? minLines, maxLines, maxLength;
  final bool inlineNumericPad;
  final Key? fieldKey;

  @override
  State<StaffTouchField> createState() => _StaffTouchFieldState();
}

class _StaffTouchFieldState extends State<StaffTouchField> {
  TextEditingController? _owned;
  bool _opening = false;
  TextEditingController get _controller =>
      widget.controller ?? (_owned ??= TextEditingController());
  bool get _numeric => widget.keyboardType?.index == TextInputType.number.index;

  List<TextInputFormatter> get _formatters => [
    ...?widget.inputFormatters,
    if (widget.maxLength != null)
      LengthLimitingTextInputFormatter(widget.maxLength),
  ];

  Future<void> _openKeyboard() async {
    if (_opening || !widget.enabled) return;
    if (widget.inlineNumericPad) {
      _controller.selection = TextSelection(
        baseOffset: 0,
        extentOffset: _controller.text.length,
      );
      return;
    }
    _opening = true;
    FocusScope.of(context).unfocus();
    try {
      final value = await showDialog<String>(
        context: context,
        builder: (_) => _StaffTouchInputDialog(
          initialValue: _controller.text,
          title:
              widget.decoration.labelText ??
              widget.decoration.hintText ??
              staffText('Ввод', 'Енгізу', 'Input'),
          numeric: _numeric,
          decimal: widget.keyboardType?.decimal == true,
          obscure: widget.obscureText,
          inputFormatters: _formatters,
          initialLayout:
              widget.autofillHints?.contains(AutofillHints.username) == true ||
                  widget.autofillHints?.contains(AutofillHints.password) == true
              ? 'EN'
              : null,
        ),
      );
      if (!mounted || value == null || !widget.enabled) return;
      if (_controller.text != value) {
        _controller.value = TextEditingValue(
          text: value,
          selection: TextSelection.collapsed(offset: value.length),
        );
        widget.onChanged?.call(value);
      }
    } finally {
      _opening = false;
    }
  }

  @override
  Widget build(BuildContext context) {
    final touch = StaffDesktopScope.enabledOf(context);
    final field = widget.validator != null
        ? TextFormField(
            key: widget.fieldKey,
            controller: _controller,
            decoration: widget.decoration,
            enabled: widget.enabled,
            readOnly: touch,
            showCursor: true,
            autofocus: widget.autofocus && !touch,
            obscureText: widget.obscureText,
            autocorrect: widget.autocorrect,
            enableSuggestions: widget.enableSuggestions,
            keyboardType: widget.keyboardType,
            textInputAction: widget.textInputAction,
            inputFormatters: widget.inputFormatters,
            autofillHints: widget.autofillHints,
            onChanged: widget.onChanged,
            onFieldSubmitted: widget.onSubmitted,
            onTap: touch ? _openKeyboard : null,
            onTapOutside: widget.onTapOutside,
            minLines: widget.minLines,
            maxLines: widget.maxLines,
            maxLength: widget.maxLength,
            validator: widget.validator,
          )
        : TextField(
            key: widget.fieldKey,
            controller: _controller,
            decoration: widget.decoration,
            enabled: widget.enabled,
            readOnly: touch,
            showCursor: true,
            autofocus: widget.autofocus && !touch,
            obscureText: widget.obscureText,
            autocorrect: widget.autocorrect,
            enableSuggestions: widget.enableSuggestions,
            keyboardType: widget.keyboardType,
            textInputAction: widget.textInputAction,
            inputFormatters: widget.inputFormatters,
            autofillHints: widget.autofillHints,
            onChanged: widget.onChanged,
            onSubmitted: widget.onSubmitted,
            onTap: touch ? _openKeyboard : null,
            onTapOutside: widget.onTapOutside,
            minLines: widget.minLines,
            maxLines: widget.maxLines,
            maxLength: widget.maxLength,
          );
    if (!touch || !widget.inlineNumericPad) return field;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        field,
        const SizedBox(height: 12),
        StaffTouchKeyboard(
          controller: _controller,
          numeric: true,
          decimal: widget.keyboardType?.decimal == true,
          enabled: widget.enabled,
          inputFormatters: _formatters,
          onChanged: widget.onChanged,
        ),
      ],
    );
  }

  @override
  void dispose() {
    _owned?.dispose();
    super.dispose();
  }
}

class _StaffTouchInputDialog extends StatefulWidget {
  const _StaffTouchInputDialog({
    required this.initialValue,
    required this.title,
    required this.numeric,
    required this.decimal,
    required this.obscure,
    required this.inputFormatters,
    this.initialLayout,
  });
  final String initialValue, title;
  final bool numeric, decimal, obscure;
  final List<TextInputFormatter> inputFormatters;
  final String? initialLayout;

  @override
  State<_StaffTouchInputDialog> createState() => _StaffTouchInputDialogState();
}

class _StaffTouchInputDialogState extends State<_StaffTouchInputDialog> {
  late final _draft = TextEditingController(text: widget.initialValue)
    ..selection = TextSelection(
      baseOffset: 0,
      extentOffset: widget.initialValue.length,
    );

  @override
  Widget build(BuildContext context) => Dialog(
    insetPadding: const EdgeInsets.all(16),
    child: ConstrainedBox(
      constraints: BoxConstraints(maxWidth: widget.numeric ? 420 : 940),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(widget.title, style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 16),
            TextField(
              key: const ValueKey('staff-touch-draft'),
              controller: _draft,
              readOnly: true,
              showCursor: true,
              autofocus: true,
              obscureText: widget.obscure,
              enableSuggestions: false,
              autocorrect: false,
              decoration: const InputDecoration(),
            ),
            const SizedBox(height: 16),
            Flexible(
              child: SingleChildScrollView(
                child: StaffTouchKeyboard(
                  controller: _draft,
                  numeric: widget.numeric,
                  decimal: widget.decimal,
                  inputFormatters: widget.inputFormatters,
                  initialLayout: widget.initialLayout,
                ),
              ),
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    key: const ValueKey('staff-touch-cancel'),
                    onPressed: () => Navigator.pop(context),
                    child: Text(staffText('Отмена', 'Бас тарту', 'Cancel')),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: FilledButton(
                    key: const ValueKey('staff-touch-done'),
                    onPressed: () => Navigator.pop(context, _draft.text),
                    child: Text(staffText('Готово', 'Дайын', 'Done')),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    ),
  );

  @override
  void dispose() {
    _draft.clear();
    _draft.dispose();
    super.dispose();
  }
}

/// Editing follows the current selection, so the first digit replaces a
/// selected zero/current quantity. Text formatters apply to touch input too.
class StaffTouchKeyboard extends StatefulWidget {
  const StaffTouchKeyboard({
    required this.controller,
    this.numeric = false,
    this.decimal = false,
    this.enabled = true,
    this.inputFormatters = const [],
    this.onChanged,
    this.initialLayout,
    super.key,
  });
  final TextEditingController controller;
  final bool numeric, decimal, enabled;
  final List<TextInputFormatter> inputFormatters;
  final ValueChanged<String>? onChanged;
  final String? initialLayout;

  @override
  State<StaffTouchKeyboard> createState() => _StaffTouchKeyboardState();
}

class _StaffTouchKeyboardState extends State<StaffTouchKeyboard> {
  String _layout = 'EN';
  bool _upper = false;

  @override
  void initState() {
    super.initState();
    _layout =
        widget.initialLayout ??
        switch (AppLang.current) {
          'kk' => 'KK',
          'ru' => 'RU',
          _ => 'EN',
        };
    if (widget.numeric &&
        !widget.controller.selection.isValid &&
        widget.controller.text.isNotEmpty) {
      widget.controller.selection = TextSelection(
        baseOffset: 0,
        extentOffset: widget.controller.text.length,
      );
    }
  }

  void _edit(String inserted, {bool backspace = false, bool clear = false}) {
    if (!widget.enabled) return;
    final old = widget.controller.value;
    final selection = old.selection;
    var start = selection.isValid ? selection.start : old.text.length;
    var end = selection.isValid ? selection.end : old.text.length;
    start = start.clamp(0, old.text.length);
    end = end.clamp(start, old.text.length);
    if (clear) {
      start = 0;
      end = old.text.length;
    } else if (backspace && start == end && start > 0) {
      start -= old.text.substring(0, start).characters.last.length;
    }
    final text = old.text.replaceRange(start, end, inserted);
    if (widget.numeric &&
        !(widget.decimal ? RegExp(r'^\d*(?:[.,]\d{0,3})?$') : RegExp(r'^\d*$'))
            .hasMatch(text)) {
      return;
    }
    var next = TextEditingValue(
      text: text,
      selection: TextSelection.collapsed(offset: start + inserted.length),
    );
    for (final formatter in widget.inputFormatters) {
      next = formatter.formatEditUpdate(old, next);
    }
    if (next.text == old.text) return;
    widget.controller.value = next;
    widget.onChanged?.call(next.text);
  }

  Widget _key(
    String text, {
    String? value,
    IconData? icon,
    VoidCallback? action,
  }) {
    final height = max(56.0, MediaQuery.textScalerOf(context).scale(22) + 24);
    return SizedBox(
      height: height,
      child: OutlinedButton(
        key: ValueKey('staff-touch-key-${value ?? text}'),
        style: OutlinedButton.styleFrom(
          backgroundColor: const Color(0xFFF9F5EE),
          padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 8),
          minimumSize: const Size(48, 56),
          tapTargetSize: MaterialTapTargetSize.shrinkWrap,
          textStyle: const TextStyle(
            fontFamily: _descriptionFont,
            fontSize: 22,
            fontWeight: FontWeight.w600,
          ),
        ),
        onPressed: !widget.enabled
            ? null
            : action ?? () => _edit(value ?? text),
        child: icon == null
            ? Text(text)
            : Tooltip(message: text, child: Icon(icon)),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (widget.numeric) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final row in [
            ['7', '8', '9'],
            ['4', '5', '6'],
            ['1', '2', '3'],
          ])
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(
                children: [
                  for (var i = 0; i < row.length; i++) ...[
                    if (i > 0) const SizedBox(width: 8),
                    Expanded(child: _key(row[i])),
                  ],
                ],
              ),
            ),
          Row(
            children: [
              Expanded(
                child: widget.decimal
                    ? _key(',', value: '.')
                    : _key(
                        staffText('Очистить', 'Тазалау', 'Clear'),
                        value: 'clear',
                        icon: Icons.clear_all_rounded,
                        action: () => _edit('', clear: true),
                      ),
              ),
              const SizedBox(width: 8),
              Expanded(child: _key('0')),
              const SizedBox(width: 8),
              Expanded(
                child: _key(
                  staffText('Удалить символ', 'Таңбаны өшіру', 'Backspace'),
                  value: 'backspace',
                  icon: Icons.backspace_outlined,
                  action: () => _edit('', backspace: true),
                ),
              ),
            ],
          ),
          if (widget.decimal) ...[
            const SizedBox(height: 8),
            OutlinedButton.icon(
              key: const ValueKey('staff-touch-key-clear'),
              onPressed: widget.enabled ? () => _edit('', clear: true) : null,
              icon: const Icon(Icons.clear_all_rounded),
              label: Text(staffText('Очистить', 'Тазалау', 'Clear')),
            ),
          ],
        ],
      );
    }
    final letters = switch (_layout) {
      'RU' => 'йцукенгшщзхъфывапролджэячсмитьбюё',
      'KK' => 'йцукенгшщзхъфывапролджэячсмитьбюәіңғүұқөһ',
      '123' => '1234567890!@#\$%^&*()-_=+[]{};:\'",.<>/?\\|',
      _ => 'qwertyuiopasdfghjklzxcvbnm',
    };
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final layout in ['RU', 'KK', 'EN', '123'])
              OutlinedButton(
                key: ValueKey('staff-touch-layout-$layout'),
                style: OutlinedButton.styleFrom(
                  backgroundColor: _layout == layout
                      ? const Color(0xFFFFF1D3)
                      : null,
                ),
                onPressed: widget.enabled
                    ? () => setState(() => _layout = layout)
                    : null,
                child: Text(layout),
              ),
          ],
        ),
        const SizedBox(height: 12),
        LayoutBuilder(
          builder: (context, constraints) {
            final keyWidth = max(
              64.0,
              MediaQuery.textScalerOf(context).scale(22) + 16,
            );
            final columns = ((constraints.maxWidth + 8) / keyWidth)
                .floor()
                .clamp(1, 10);
            final width = (constraints.maxWidth - 8 * (columns - 1)) / columns;
            return Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final letter in letters.characters)
                  SizedBox(
                    width: width,
                    child: _key(_upper ? letter.toUpperCase() : letter),
                  ),
              ],
            );
          },
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(
              child: _key(
                staffText('Регистр', 'Регистр', 'Shift'),
                value: 'shift',
                icon: _upper ? Icons.keyboard_capslock : Icons.arrow_upward,
                action: () => setState(() => _upper = !_upper),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(flex: 3, child: _key('␣', value: ' ')),
            const SizedBox(width: 8),
            Expanded(
              child: _key(
                staffText('Удалить символ', 'Таңбаны өшіру', 'Backspace'),
                value: 'backspace',
                icon: Icons.backspace_outlined,
                action: () => _edit('', backspace: true),
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        OutlinedButton.icon(
          key: const ValueKey('staff-touch-key-clear'),
          onPressed: widget.enabled ? () => _edit('', clear: true) : null,
          icon: const Icon(Icons.clear_all_rounded),
          label: Text(staffText('Очистить', 'Тазалау', 'Clear')),
        ),
      ],
    );
  }
}
