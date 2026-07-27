part of '../main.dart';

class _ProductFactIcon extends StatelessWidget {
  const _ProductFactIcon({required this.value, required this.isAllergen});

  final String value;
  final bool isAllergen;

  double _assetExtent(String assetName) => switch (assetName) {
    // EAC has a much denser silhouette than the circular marks. A smaller
    // optical box keeps all certificates equally weighted in the grid.
    'eac' => 54,
    'under-3' || 'traces-nuts-sesame' => 60,
    _ => 62,
  };

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    final assetName = isAllergen
        ? _allergenIconName(value)
        : _productMarkIconName(value);
    final label = isAllergen
        ? localizeAllergenLabel(value)
        : localizeProductMarkLabel(value);
    return Semantics(
      label: label,
      image: true,
      child: SizedBox(
        width: double.infinity,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox.square(
              dimension: 72,
              child: Center(
                child: assetName != null
                    ? Image.asset(
                        'assets/product_marks/$assetName.png',
                        width: _assetExtent(assetName),
                        height: _assetExtent(assetName),
                        fit: BoxFit.contain,
                        alignment: Alignment.center,
                        filterQuality: FilterQuality.high,
                        excludeFromSemantics: true,
                      )
                    : Container(
                        width: 58,
                        height: 58,
                        decoration: BoxDecoration(
                          color: colors.brandGold.withValues(alpha: 0.14),
                          shape: BoxShape.circle,
                          border: Border.all(color: colors.cardBorder),
                        ),
                        child: Icon(
                          isAllergen
                              ? Icons.warning_amber_rounded
                              : Icons.verified_outlined,
                          color: colors.brandBrown,
                        ),
                      ),
              ),
            ),
            const SizedBox(height: 5),
            ConstrainedBox(
              constraints: const BoxConstraints(minHeight: 32),
              child: Center(
                child: Text(
                  label,
                  maxLines: 3,
                  overflow: TextOverflow.ellipsis,
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontFamily: _descriptionFont,
                    color: colors.brandBrown,
                    fontSize: BulkaTypeScale.caption,
                    height: 1.18,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ProductFactGrid extends StatelessWidget {
  const _ProductFactGrid({required this.values, required this.isAllergen});

  final List<String> values;
  final bool isAllergen;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final columns = constraints.maxWidth >= 640
            ? 4
            : constraints.maxWidth >= 440
            ? 3
            : 2;
        const spacing = 12.0;
        final cellWidth =
            (constraints.maxWidth - spacing * (columns - 1)) / columns;
        return Wrap(
          alignment: WrapAlignment.center,
          crossAxisAlignment: WrapCrossAlignment.start,
          spacing: spacing,
          runSpacing: 16,
          children: values
              .map(
                (value) => SizedBox(
                  width: cellWidth,
                  child: _ProductFactIcon(value: value, isAllergen: isAllergen),
                ),
              )
              .toList(),
        );
      },
    );
  }
}

class _ProductStorageConditions extends StatelessWidget {
  const _ProductStorageConditions({required this.conditions});

  final List<ProductStorageCondition> conditions;

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    return LayoutBuilder(
      builder: (context, constraints) {
        final textScale = MediaQuery.textScalerOf(context).scale(1);
        final columns =
            conditions.length > 1 &&
                constraints.maxWidth >= 280 &&
                textScale <= 1.3
            ? 2
            : 1;
        const spacing = 16.0;
        final cellWidth =
            (constraints.maxWidth - spacing * (columns - 1)) / columns;
        return Wrap(
          alignment: WrapAlignment.center,
          spacing: spacing,
          runSpacing: 18,
          children: conditions
              .map(
                (condition) => Semantics(
                  label:
                      '${'catalog_storage_at_temperature'.tr} ${condition.temperature}, ${productStorageDurationLabel(condition)}',
                  child: SizedBox(
                    width: cellWidth,
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          'catalog_storage_at_temperature'.tr,
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            fontFamily: _descriptionFont,
                            color: colors.mutedText,
                            fontSize: BulkaTypeScale.bodySmall,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                        const SizedBox(height: 7),
                        Text(
                          condition.temperature,
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            fontFamily: _descriptionFont,
                            color: colors.brandGold,
                            fontSize: BulkaTypeScale.title,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 5),
                        Text(
                          productStorageDurationLabel(condition),
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            fontFamily: _descriptionFont,
                            color: colors.brandGold,
                            fontSize: BulkaTypeScale.body,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              )
              .toList(),
        );
      },
    );
  }
}
