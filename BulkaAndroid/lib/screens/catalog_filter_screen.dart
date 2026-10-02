part of '../main.dart';

@visibleForTesting
Widget buildCatalogFilterActionsForTest({
  required VoidCallback onApply,
  required VoidCallback onReset,
}) => _CatalogFilterActions(onApply: onApply, onReset: onReset);

class _CatalogFilterActions extends StatelessWidget {
  const _CatalogFilterActions({required this.onApply, required this.onReset});

  final VoidCallback onApply;
  final VoidCallback onReset;

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    const applyStyle = TextStyle(
      fontFamily: _headingFont,
      fontSize: BulkaTypeScale.body,
      fontWeight: FontWeight.w700,
      color: _textDark,
    );
    final resetStyle = TextStyle(
      fontFamily: _headingFont,
      fontSize: BulkaTypeScale.body,
      fontWeight: FontWeight.w600,
      color: colors.brandBrown,
    );
    final applyLabel = 'catalog_apply'.tr;
    final resetLabel = 'catalog_reset'.tr;
    final applyButton = ElevatedButton(
      key: const ValueKey('catalog-filter-apply'),
      onPressed: onApply,
      style: ElevatedButton.styleFrom(
        minimumSize: const Size(0, 50),
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 13),
        backgroundColor: _bulkaYellow,
        foregroundColor: _textDark,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(BulkaRadii.card),
        ),
      ),
      child: Text(applyLabel, textAlign: TextAlign.center, style: applyStyle),
    );
    final resetButton = OutlinedButton(
      key: const ValueKey('catalog-filter-reset'),
      onPressed: onReset,
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(0, 50),
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 13),
        side: BorderSide(color: colors.brandBrown, width: 1.5),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(BulkaRadii.card),
        ),
      ),
      child: Text(resetLabel, textAlign: TextAlign.center, style: resetStyle),
    );
    return LayoutBuilder(
      builder: (context, constraints) {
        double textWidth(String text, TextStyle style) {
          final painter = TextPainter(
            text: TextSpan(text: text, style: style),
            textDirection: Directionality.of(context),
            textScaler: MediaQuery.textScalerOf(context),
          )..layout();
          final width = painter.width;
          painter.dispose();
          return width;
        }

        final available = constraints.maxWidth - 12;
        final stack =
            textWidth(applyLabel, applyStyle) + 40 > available * .55 ||
            textWidth(resetLabel, resetStyle) + 40 > available * .45;
        if (stack) {
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [applyButton, const SizedBox(height: 10), resetButton],
          );
        }
        return Row(
          children: [
            Expanded(flex: 11, child: applyButton),
            const SizedBox(width: 12),
            Expanded(flex: 9, child: resetButton),
          ],
        );
      },
    );
  }
}

class _CatalogFilterScreen extends StatefulWidget {
  const _CatalogFilterScreen({
    required this.initialSort,
    required this.dietaryTags,
    required this.allergens,
    required this.initialDietaryTags,
    required this.initialExcludedAllergens,
  });

  final _CatalogSort initialSort;
  final List<String> dietaryTags;
  final List<String> allergens;
  final Set<String> initialDietaryTags;
  final Set<String> initialExcludedAllergens;

  @override
  State<_CatalogFilterScreen> createState() => _CatalogFilterScreenState();
}

class _CatalogFilterScreenState extends State<_CatalogFilterScreen> {
  final Set<String> _expandedSections = {'sort'};
  final Set<String> _selectedFilters = {};

  Map<String, List<String>> get _sections => {
    'sort': const ['menu', 'priceLow', 'priceHigh'],
    if (widget.dietaryTags.isNotEmpty)
      'dietary': widget.dietaryTags.map((tag) => 'dietary:$tag').toList(),
    if (widget.allergens.isNotEmpty)
      'allergens': widget.allergens
          .map((allergen) => 'allergen:$allergen')
          .toList(),
  };

  @override
  void initState() {
    super.initState();
    _selectedFilters.add(widget.initialSort.name);
    _selectedFilters.addAll(
      widget.initialDietaryTags.map((tag) => 'dietary:$tag'),
    );
    _selectedFilters.addAll(
      widget.initialExcludedAllergens.map((allergen) => 'allergen:$allergen'),
    );
    if (widget.initialDietaryTags.isNotEmpty) _expandedSections.add('dietary');
    if (widget.initialExcludedAllergens.isNotEmpty) {
      _expandedSections.add('allergens');
    }
  }

  void _toggleSection(String title) {
    setState(() {
      if (_expandedSections.contains(title)) {
        _expandedSections.remove(title);
      } else {
        _expandedSections.add(title);
      }
    });
  }

  void _toggleFilter(String option) {
    setState(() {
      if (option.startsWith('dietary:') || option.startsWith('allergen:')) {
        if (_selectedFilters.contains(option)) {
          _selectedFilters.remove(option);
        } else {
          _selectedFilters.add(option);
        }
      } else {
        _selectedFilters.removeAll(
          _CatalogSort.values.map((sort) => sort.name),
        );
        _selectedFilters.add(option);
      }
    });
  }

  String _optionLabel(String option) {
    return switch (option) {
      'priceLow' => 'catalog_sort_price_low'.tr,
      'priceHigh' => 'catalog_sort_price_high'.tr,
      _ when option.startsWith('dietary:') => localizeProductMarkLabel(
        option.substring('dietary:'.length),
      ),
      _ when option.startsWith('allergen:') => localizeAllergenLabel(
        option.substring('allergen:'.length),
      ),
      _ => 'catalog_sort_default'.tr,
    };
  }

  String _sectionLabel(String section) => switch (section) {
    'sort' => 'catalog_sort_title'.tr,
    'dietary' => 'catalog_dietary_filters'.tr,
    'allergens' => 'catalog_exclude_allergens'.tr,
    _ => section,
  };

  void _apply() {
    final sort = _selectedFilters.contains('priceLow')
        ? _CatalogSort.priceLow
        : _selectedFilters.contains('priceHigh')
        ? _CatalogSort.priceHigh
        : _CatalogSort.menu;
    Navigator.of(context).pop(
      _CatalogFilterResult(
        sort: sort,
        dietaryTags: _selectedFilters
            .where((value) => value.startsWith('dietary:'))
            .map((value) => value.substring('dietary:'.length))
            .toSet(),
        excludedAllergens: _selectedFilters
            .where((value) => value.startsWith('allergen:'))
            .map((value) => value.substring('allergen:'.length))
            .toSet(),
      ),
    );
  }

  void _reset() {
    setState(() {
      _selectedFilters
        ..clear()
        ..add(_CatalogSort.menu.name);
    });
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              child: Row(
                children: [
                  SizedBox(
                    width: BulkaLayout.appBarSideSlot,
                    child: IconButton(
                      onPressed: () => Navigator.of(context).pop(),
                      icon: Icon(
                        Icons.chevron_left_rounded,
                        size: 28,
                        color: colors.brandBrown,
                      ),
                      tooltip: 'back_tooltip'.tr,
                      style: IconButton.styleFrom(
                        minimumSize: const Size(48, 48),
                        tapTargetSize: MaterialTapTargetSize.padded,
                      ),
                    ),
                  ),
                  Expanded(
                    child: Center(
                      child: _BulkaPageTitle(
                        'catalog_filter'.tr,
                        color: scheme.onSurface,
                      ),
                    ),
                  ),
                  const SizedBox(width: BulkaLayout.appBarSideSlot),
                ],
              ),
            ),
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.symmetric(
                  horizontal: 20,
                  vertical: 8,
                ),
                child: Column(
                  children: _sections.entries.map((entry) {
                    final sectionTitle = entry.key;
                    final options = entry.value;
                    final isExpanded = _expandedSections.contains(sectionTitle);

                    return Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Semantics(
                          button: true,
                          label: _sectionLabel(sectionTitle),
                          hint: isExpanded
                              ? 'catalog_filter_collapse'.tr
                              : 'catalog_filter_expand'.tr,
                          excludeSemantics: true,
                          child: InkWell(
                            onTap: () => _toggleSection(sectionTitle),
                            child: Padding(
                              padding: const EdgeInsets.symmetric(vertical: 16),
                              child: Row(
                                mainAxisAlignment:
                                    MainAxisAlignment.spaceBetween,
                                children: [
                                  Text(
                                    _sectionLabel(sectionTitle),
                                    style: TextStyle(
                                      fontSize: BulkaTypeScale.body,
                                      fontWeight: FontWeight.w600,
                                      color: scheme.onSurface,
                                    ),
                                  ),
                                  AnimatedRotation(
                                    turns: isExpanded ? 0.5 : 0,
                                    duration: BulkaMotion.duration(
                                      context,
                                      BulkaMotion.fast,
                                    ),
                                    curve: BulkaMotion.standardCurve,
                                    child: Icon(
                                      Icons.keyboard_arrow_down_rounded,
                                      color: colors.brandBrown,
                                      size: 24,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                        BulkaExpandable(
                          expanded: isExpanded,
                          duration: BulkaMotion.fast,
                          child: Column(
                            children: options.map((option) {
                              final isSelected = _selectedFilters.contains(
                                option,
                              );
                              final isSingleChoice = sectionTitle == 'sort';
                              return Semantics(
                                checked: isSelected,
                                inMutuallyExclusiveGroup: isSingleChoice,
                                label: _optionLabel(option),
                                excludeSemantics: true,
                                child: InkWell(
                                  onTap: () => _toggleFilter(option),
                                  child: AnimatedContainer(
                                    duration: BulkaMotion.duration(
                                      context,
                                      const Duration(milliseconds: 180),
                                    ),
                                    curve: Curves.easeOutCubic,
                                    decoration: BoxDecoration(
                                      color: isSelected
                                          ? colors.brandGold.withValues(
                                              alpha: 0.12,
                                            )
                                          : Colors.transparent,
                                      borderRadius: BorderRadius.circular(12),
                                    ),
                                    padding: const EdgeInsets.symmetric(
                                      vertical: 12,
                                      horizontal: 8,
                                    ),
                                    child: Row(
                                      children: [
                                        Expanded(
                                          child: Text(
                                            _optionLabel(option),
                                            style: TextStyle(
                                              fontSize: BulkaTypeScale.body,
                                              color: isSelected
                                                  ? scheme.onSurface
                                                  : colors.mutedText,
                                              fontWeight: isSelected
                                                  ? FontWeight.w600
                                                  : FontWeight.w400,
                                            ),
                                          ),
                                        ),
                                        const SizedBox(width: 16),
                                        Container(
                                          width: 22,
                                          height: 22,
                                          decoration: BoxDecoration(
                                            shape: isSingleChoice
                                                ? BoxShape.circle
                                                : BoxShape.rectangle,
                                            color: isSingleChoice
                                                ? Colors.white
                                                : isSelected
                                                ? _bulkaYellow
                                                : Colors.white,
                                            borderRadius: isSingleChoice
                                                ? null
                                                : BorderRadius.circular(6),
                                            border: Border.all(
                                              color: isSelected
                                                  ? colors.brandBrown
                                                  : colors.cardBorder,
                                              width: isSelected ? 2 : 1.5,
                                            ),
                                          ),
                                          child: isSelected
                                              ? isSingleChoice
                                                    ? Center(
                                                        child: Container(
                                                          width: 10,
                                                          height: 10,
                                                          decoration:
                                                              BoxDecoration(
                                                                color: colors
                                                                    .brandBrown,
                                                                shape: BoxShape
                                                                    .circle,
                                                              ),
                                                        ),
                                                      )
                                                    : const Icon(
                                                        Icons.check_rounded,
                                                        size: 15,
                                                        color: _textDark,
                                                      )
                                              : null,
                                        ),
                                      ],
                                    ),
                                  ),
                                ),
                              );
                            }).toList(),
                          ),
                        ),
                        Divider(color: colors.cardBorder, height: 1),
                      ],
                    );
                  }).toList(),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 20),
              child: _CatalogFilterActions(onApply: _apply, onReset: _reset),
            ),
          ],
        ),
      ),
    );
  }
}
