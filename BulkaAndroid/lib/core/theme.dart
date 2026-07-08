part of '../main.dart';

const _bulkaYellow = Color(0xFFE8A11A);
const _bulkaBrown = Color(0xFF5A2E1E);
const _milkyBackground = Color(0xFFFFFFFF);
const _lightCard = Color(0xFFFFFFFF);
const _lightCardHighlight = Color(0xFFFFE8C2);
const _textDark = Color(0xFF6D3317);
const _cocoa = Color(0xFF3B2117);
const _caramel = Color(0xFFC66A25);
const _cream = Color(0xFFFFFBF4);
const _almond = Color(0xFFF7D9A8);
const _sage = Color(0xFF6E7F57);
const _errorRed = Color(0xFFD14343);
const _successGreen = Color(0xFF2F8A55);
const _brandFont = 'Circe';
const _headingFont = 'KulikovSoft';

const _softShadow = [
  BoxShadow(color: Color(0x1F5A2E1E), blurRadius: 24, offset: Offset(0, 14)),
];

ThemeData buildBulkaTheme() {
  return ThemeData(
    useMaterial3: true,
    colorScheme: const ColorScheme.light(
      primary: _bulkaYellow,
      onPrimary: _textDark,
      secondary: _bulkaBrown,
      onSecondary: Colors.white,
      surface: _lightCard,
      onSurface: _textDark,
      surfaceContainerHighest: _lightCardHighlight,
      error: _errorRed,
    ),
    scaffoldBackgroundColor: _milkyBackground,
    fontFamily: _brandFont,
    textTheme: const TextTheme(
      displayLarge: TextStyle(
        fontFamily: _headingFont,
        fontWeight: FontWeight.w400,
      ),
      displayMedium: TextStyle(
        fontFamily: _headingFont,
        fontWeight: FontWeight.w400,
      ),
      displaySmall: TextStyle(
        fontFamily: _headingFont,
        fontWeight: FontWeight.w400,
      ),
      headlineLarge: TextStyle(
        fontFamily: _headingFont,
        fontWeight: FontWeight.w400,
      ),
      headlineMedium: TextStyle(
        fontFamily: _headingFont,
        fontWeight: FontWeight.w400,
      ),
      headlineSmall: TextStyle(
        fontFamily: _headingFont,
        fontWeight: FontWeight.w400,
      ),
      titleLarge: TextStyle(
        fontFamily: _headingFont,
        fontWeight: FontWeight.w400,
      ),
      titleMedium: TextStyle(
        fontFamily: _headingFont,
        fontWeight: FontWeight.w400,
      ),
      titleSmall: TextStyle(
        fontFamily: _headingFont,
        fontWeight: FontWeight.w400,
      ),
      bodyLarge: TextStyle(fontFamily: _brandFont, fontWeight: FontWeight.w400),
      bodyMedium: TextStyle(
        fontFamily: _brandFont,
        fontWeight: FontWeight.w300,
      ),
      bodySmall: TextStyle(fontFamily: _brandFont, fontWeight: FontWeight.w300),
      labelLarge: TextStyle(
        fontFamily: _brandFont,
        fontWeight: FontWeight.w400,
      ),
      labelMedium: TextStyle(
        fontFamily: _brandFont,
        fontWeight: FontWeight.w400,
      ),
      labelSmall: TextStyle(
        fontFamily: _brandFont,
        fontWeight: FontWeight.w400,
      ),
    ),
    appBarTheme: const AppBarTheme(
      centerTitle: false,
      elevation: 0,
      backgroundColor: Colors.transparent,
      foregroundColor: _textDark,
      surfaceTintColor: Colors.transparent,
      titleTextStyle: TextStyle(
        color: _textDark,
        fontSize: 22,
        fontFamily: _headingFont,
        fontWeight: FontWeight.w400,
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(0, 56),
        textStyle: const TextStyle(
          fontFamily: _brandFont,
          fontWeight: FontWeight.w400,
        ),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
      ),
    ),
  );
}
