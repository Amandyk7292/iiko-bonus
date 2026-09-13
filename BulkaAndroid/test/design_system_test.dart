import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('cards, forms and secondary buttons share the 0.8 px stroke', () {
    final theme = buildBulkaTheme();
    final cardShape = theme.cardTheme.shape! as RoundedRectangleBorder;
    final inputBorder =
        theme.inputDecorationTheme.enabledBorder! as OutlineInputBorder;
    final buttonSide = theme.outlinedButtonTheme.style!.side!.resolve({})!;

    expect(cardShape.side.width, BulkaStrokes.hairline);
    expect(inputBorder.borderSide.width, BulkaStrokes.hairline);
    expect(buttonSide.width, BulkaStrokes.hairline);
    expect(cardShape.borderRadius, BorderRadius.circular(BulkaRadii.card));
  });

  test('secondary text uses the stronger readable color', () {
    final colors = buildBulkaTheme().extension<BulkaThemeColors>()!;
    expect(colors.mutedText, const Color(0xFF69564D));
  });
}
