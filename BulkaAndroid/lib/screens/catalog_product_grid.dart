part of '../main.dart';

({int columns, double spacing, double cardExtent}) catalogCategoryGridGeometry(
  double contentExtent,
) {
  const spacing = 14.0;
  final columns = contentExtent >= 980
      ? 4
      : contentExtent >= 620
      ? 3
      : 2;
  return (
    columns: columns,
    spacing: spacing,
    cardExtent: max(1.0, (contentExtent - spacing * (columns - 1)) / columns),
  );
}
