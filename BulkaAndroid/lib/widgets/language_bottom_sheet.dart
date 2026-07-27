part of '../main.dart';

Future<String?> showLanguageBottomSheet(
  BuildContext context, {
  String? initialCode,
}) {
  var tempCode = initialCode ?? AppLang.current;

  return showModalBottomSheet<String>(
    context: context,
    backgroundColor: Colors.transparent,
    isScrollControlled: true,
    barrierLabel: 'close_tooltip'.tr,
    builder: (context) {
      return StatefulBuilder(
        builder: (context, setModalState) {
          final colors = context.bulkaColors;
          return SafeArea(
            top: false,
            child: Container(
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.surface,
                borderRadius: const BorderRadius.vertical(
                  top: Radius.circular(BulkaRadii.card),
                ),
              ),
              padding: const EdgeInsets.fromLTRB(24, 12, 24, 24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 42,
                    height: 4,
                    decoration: BoxDecoration(
                      color: colors.cardBorder,
                      borderRadius: BorderRadius.circular(BulkaRadii.pill),
                    ),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      const SizedBox(width: 48),
                      Expanded(
                        child: Text(
                          'select_lang_title'.tr,
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            color: Theme.of(context).colorScheme.onSurface,
                            fontFamily: _headingFont,
                            fontSize: BulkaTypeScale.title,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                      IconButton(
                        onPressed: () => Navigator.pop(context),
                        tooltip: 'close_tooltip'.tr,
                        style: IconButton.styleFrom(
                          backgroundColor: colors.cardBorder,
                          foregroundColor: colors.brandBrown,
                          minimumSize: const Size(48, 48),
                          tapTargetSize: MaterialTapTargetSize.padded,
                        ),
                        icon: const Icon(Icons.close_rounded, size: 20),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  for (final code in AppLang.supportedCodes)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: _LanguageOption(
                        code: code,
                        selected: tempCode == code,
                        onTap: () => setModalState(() => tempCode = code),
                      ),
                    ),
                  const SizedBox(height: 10),
                  BulkaPressScale(
                    child: SizedBox(
                      width: double.infinity,
                      child: ElevatedButton(
                        onPressed: () {
                          BulkaMotion.selection();
                          Navigator.pop(context, tempCode);
                        },
                        style: ElevatedButton.styleFrom(
                          backgroundColor: colors.goldSoft,
                          foregroundColor: _textDark,
                          elevation: 0,
                          minimumSize: const Size.fromHeight(52),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(
                              BulkaRadii.card,
                            ),
                          ),
                        ),
                        child: Text(
                          'apply_btn'.tr,
                          style: const TextStyle(
                            fontFamily: _headingFont,
                            fontSize: BulkaTypeScale.body,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      );
    },
  );
}

class _LanguageOption extends StatelessWidget {
  const _LanguageOption({
    required this.code,
    required this.selected,
    required this.onTap,
  });

  final String code;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    final scheme = Theme.of(context).colorScheme;
    return BulkaPressScale(
      child: Semantics(
        button: true,
        selected: selected,
        inMutuallyExclusiveGroup: true,
        label: AppLang.languageName(code),
        child: Material(
          color: selected ? colors.surfaceCream : Colors.transparent,
          borderRadius: BorderRadius.circular(BulkaRadii.control),
          child: InkWell(
            onTap: () {
              BulkaMotion.selection();
              onTap();
            },
            borderRadius: BorderRadius.circular(BulkaRadii.control),
            child: Container(
              constraints: const BoxConstraints(minHeight: 52),
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      AppLang.languageName(code),
                      style: TextStyle(
                        color: selected ? colors.brandBrown : scheme.onSurface,
                        fontSize: BulkaTypeScale.body,
                        fontWeight: selected
                            ? FontWeight.w700
                            : FontWeight.w500,
                      ),
                    ),
                  ),
                  Icon(
                    selected
                        ? Icons.radio_button_checked_rounded
                        : Icons.radio_button_unchecked_rounded,
                    color: selected ? colors.brandBrown : colors.cardBorder,
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
