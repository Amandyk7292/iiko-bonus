part of '../main.dart';

class CatalogAllCategoriesScreen extends StatelessWidget {
  const CatalogAllCategoriesScreen({
    required this.categories,
    required this.selectedCategory,
    required this.onSelectCategory,
    required this.apiCategoryImages,
    super.key,
  });

  final List<String> categories;
  final String selectedCategory;
  final ValueChanged<String> onSelectCategory;
  final Map<String, String> apiCategoryImages;

  @override
  Widget build(BuildContext context) {
    final displayCategories = categories
        .where((category) => category != _catalogAllCategoryKey)
        .toList();
    final colors = context.bulkaColors;
    final scheme = Theme.of(context).colorScheme;

    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
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
                        'nav_catalog'.tr,
                        color: scheme.onSurface,
                      ),
                    ),
                  ),
                  const SizedBox(width: BulkaLayout.appBarSideSlot),
                ],
              ),
            ),
            Expanded(
              child: LayoutBuilder(
                builder: (context, constraints) {
                  final textScale = MediaQuery.textScalerOf(context).scale(1);
                  final columns = constraints.maxWidth >= 900
                      ? 4
                      : constraints.maxWidth >= 600
                      ? 3
                      : 2;
                  return GridView.builder(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 16,
                      vertical: 12,
                    ),
                    gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                      crossAxisCount: columns,
                      mainAxisSpacing: 16,
                      crossAxisSpacing: 12,
                      mainAxisExtent: textScale > 1.2 ? 218 : 190,
                    ),
                    itemCount: displayCategories.length,
                    itemBuilder: (context, i) {
                      final cat = displayCategories[i];
                      final imageUrl = apiCategoryImages[cat] ?? '';

                      return Semantics(
                        button: true,
                        selected: selectedCategory == cat,
                        label: cat,
                        child: BulkaPressScale(
                          child: Material(
                            color: Colors.transparent,
                            child: InkWell(
                              onTap: () {
                                onSelectCategory(cat);
                                Navigator.of(context).pop();
                              },
                              borderRadius: BorderRadius.circular(
                                BulkaRadii.control,
                              ),
                              child: Ink(
                                padding: const EdgeInsets.all(8),
                                decoration: BoxDecoration(
                                  color: scheme.surface,
                                  borderRadius: BorderRadius.circular(
                                    BulkaRadii.control,
                                  ),
                                  border: Border.all(
                                    color: selectedCategory == cat
                                        ? _bulkaYellow
                                        : context.bulkaColors.cardBorder,
                                    width: selectedCategory == cat ? 2 : 1,
                                  ),
                                ),
                                child: Column(
                                  crossAxisAlignment:
                                      CrossAxisAlignment.stretch,
                                  children: [
                                    Expanded(
                                      child: ClipRRect(
                                        borderRadius: BorderRadius.circular(
                                          BulkaRadii.control,
                                        ),
                                        child: _NetworkImage(
                                          url: imageUrl,
                                          fit: BoxFit.cover,
                                          semanticLabel: cat,
                                        ),
                                      ),
                                    ),
                                    const SizedBox(height: 10),
                                    Text(
                                      cat,
                                      maxLines: 2,
                                      overflow: TextOverflow.ellipsis,
                                      style: TextStyle(
                                        fontFamily: _headingFont,
                                        fontSize: BulkaTypeScale.bodySmall,
                                        fontWeight: FontWeight.w700,
                                        color: scheme.onSurface,
                                        height: 1.25,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          ),
                        ),
                      );
                    },
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}
