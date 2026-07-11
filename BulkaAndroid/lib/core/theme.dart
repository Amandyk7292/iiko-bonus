part of '../main.dart';

const _bulkaYellow = Color(0xFFFFB814);
const _bulkaBrown = Color(0xFF532814);
const _milkyBackground = Color(0xFFFFFFFF);
const _lightCard = Color(0xFFFFFFFF);
const _lightCardHighlight = Color(0xFFFFE8C2);
const _textDark = Color(0xFF532814);
const _cocoa = Color(0xFF3B2117);
const _caramel = Color(0xFFC85A1C);
const _cream = Color(0xFFFFFBF5);
const _almond = Color(0xFFF2DAA9);
const _sage = Color(0xFF6E7F57);
const _errorRed = Color(0xFFD14343);
const _successGreen = Color(0xFF2F8A55);
const _brandFont = 'Circe';
const _headingFont = 'KulikovSoft';

const _softShadow = [
  BoxShadow(color: Color(0x1F6D3317), blurRadius: 24, offset: Offset(0, 14)),
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
        color: _textDark,
        fontFamily: _headingFont,
        fontWeight: FontWeight.w400,
      ),
      displayMedium: TextStyle(
        color: _textDark,
        fontFamily: _headingFont,
        fontWeight: FontWeight.w400,
      ),
      displaySmall: TextStyle(
        color: _textDark,
        fontFamily: _headingFont,
        fontWeight: FontWeight.w400,
      ),
      headlineLarge: TextStyle(
        color: _textDark,
        fontFamily: _headingFont,
        fontWeight: FontWeight.w400,
      ),
      headlineMedium: TextStyle(
        color: _textDark,
        fontFamily: _headingFont,
        fontWeight: FontWeight.w400,
      ),
      headlineSmall: TextStyle(
        color: _textDark,
        fontFamily: _headingFont,
        fontWeight: FontWeight.w400,
      ),
      titleLarge: TextStyle(
        color: _textDark,
        fontFamily: _headingFont,
        fontWeight: FontWeight.w400,
      ),
      titleMedium: TextStyle(
        color: _textDark,
        fontFamily: _headingFont,
        fontWeight: FontWeight.w400,
      ),
      titleSmall: TextStyle(
        color: _textDark,
        fontFamily: _headingFont,
        fontWeight: FontWeight.w400,
      ),
      bodyLarge: TextStyle(
        color: _textDark,
        fontFamily: _brandFont,
        fontWeight: FontWeight.w400,
      ),
      bodyMedium: TextStyle(
        color: _textDark,
        fontFamily: _brandFont,
        fontWeight: FontWeight.w300,
      ),
      bodySmall: TextStyle(
        color: _textDark,
        fontFamily: _brandFont,
        fontWeight: FontWeight.w300,
      ),
      labelLarge: TextStyle(
        color: _textDark,
        fontFamily: _brandFont,
        fontWeight: FontWeight.w400,
      ),
      labelMedium: TextStyle(
        color: _textDark,
        fontFamily: _brandFont,
        fontWeight: FontWeight.w400,
      ),
      labelSmall: TextStyle(
        color: _textDark,
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
    pageTransitionsTheme: const PageTransitionsTheme(
      builders: {
        // Android 16-style fade-forwards with an interactive predictive back
        // gesture where the platform supports it.
        TargetPlatform.android: PredictiveBackPageTransitionsBuilder(),
        TargetPlatform.fuchsia: FadeForwardsPageTransitionsBuilder(),
        // Preserve the native, interruptible swipe-back gesture on Apple
        // platforms instead of forcing an Android-like transition everywhere.
        TargetPlatform.iOS: CupertinoPageTransitionsBuilder(),
        TargetPlatform.macOS: CupertinoPageTransitionsBuilder(),
        TargetPlatform.windows: FadeForwardsPageTransitionsBuilder(),
        TargetPlatform.linux: FadeForwardsPageTransitionsBuilder(),
      },
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
