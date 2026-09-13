part of '../main.dart';

String _catalogWeightChoiceLabel(num kilograms) {
  if (kilograms < 1) {
    return 'catalog_weight_grams'.trArgs({
      'weight': productQuantityText(kilograms * 1000),
    });
  }
  return 'catalog_weight_kilograms'.trArgs({
    'weight': productQuantityText(kilograms),
  });
}

Future<num?> showCatalogWeightPicker(
  BuildContext context, {
  required CatalogProduct product,
}) async {
  const standardChoices = <num>[0.5, 1, 2];
  final limit = _catalogProductQuantityLimit(product);
  final choices = standardChoices.where((value) => value <= limit).toList();
  if (choices.isEmpty) return null;

  var selectedIndex = 0;
  return showModalBottomSheet<num>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: Colors.transparent,
    builder: (sheetContext) => StatefulBuilder(
      builder: (context, setSheetState) {
        final selected = choices[selectedIndex];
        final colors = context.bulkaColors;
        return Material(
          color: Colors.white,
          borderRadius: const BorderRadius.vertical(
            top: Radius.circular(BulkaRadii.sheet),
          ),
          child: Padding(
            padding: EdgeInsets.fromLTRB(
              24,
              12,
              24,
              24 + MediaQuery.viewPaddingOf(context).bottom,
            ),
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
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'catalog_choose_weight'.tr,
                            style: const TextStyle(
                              color: _textDark,
                              fontFamily: _headingFont,
                              fontSize: BulkaTypeScale.title,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            'catalog_choose_weight_hint'.tr,
                            style: TextStyle(
                              color: colors.mutedText,
                              fontSize: BulkaTypeScale.bodySmall,
                            ),
                          ),
                        ],
                      ),
                    ),
                    IconButton(
                      onPressed: () => Navigator.of(sheetContext).pop(),
                      tooltip: 'close_tooltip'.tr,
                      icon: const Icon(Icons.close_rounded),
                    ),
                  ],
                ),
                const SizedBox(height: 24),
                AnimatedSwitcher(
                  duration: const Duration(milliseconds: 180),
                  transitionBuilder: (child, animation) => ScaleTransition(
                    scale: animation,
                    child: FadeTransition(opacity: animation, child: child),
                  ),
                  child: Text(
                    _catalogWeightChoiceLabel(selected),
                    key: ValueKey(selected),
                    style: const TextStyle(
                      color: _textDark,
                      fontFamily: _headingFont,
                      fontSize: 32,
                      fontWeight: FontWeight.w800,
                      fontFeatures: [FontFeature.tabularFigures()],
                    ),
                  ),
                ),
                const SizedBox(height: 10),
                SliderTheme(
                  data: SliderTheme.of(context).copyWith(
                    trackHeight: 8,
                    activeTrackColor: _bulkaYellow,
                    inactiveTrackColor: const Color(0xFFFFE7AE),
                    thumbColor: colors.brandBrown,
                    overlayColor: colors.brandBrown.withValues(alpha: 0.1),
                    thumbShape: const RoundSliderThumbShape(
                      enabledThumbRadius: 13,
                    ),
                  ),
                  child: Slider(
                    key: const ValueKey('catalog-weight-slider'),
                    value: selectedIndex.toDouble(),
                    min: 0,
                    max: (choices.length - 1).toDouble(),
                    divisions: choices.length > 1 ? choices.length - 1 : null,
                    onChanged: choices.length > 1
                        ? (value) {
                            setSheetState(() => selectedIndex = value.round());
                            unawaited(BulkaMotion.selection());
                          }
                        : null,
                  ),
                ),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    for (final choice in choices)
                      Text(
                        _catalogWeightChoiceLabel(choice),
                        style: TextStyle(
                          color: choice == selected
                              ? colors.brandBrown
                              : colors.mutedText,
                          fontWeight: choice == selected
                              ? FontWeight.w700
                              : FontWeight.w500,
                          fontSize: BulkaTypeScale.caption,
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 24),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    key: const ValueKey('catalog-weight-confirm'),
                    onPressed: () {
                      unawaited(BulkaMotion.lightImpact());
                      Navigator.of(sheetContext).pop(selected);
                    },
                    style: FilledButton.styleFrom(
                      minimumSize: const Size.fromHeight(52),
                      backgroundColor: _bulkaYellow,
                      foregroundColor: _textDark,
                    ),
                    child: Text('catalog_add_weight_to_cart'.tr),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    ),
  );
}
