part of '../main.dart';

const _bulkaYellow = Color(0xFFFFB814);
const _bulkaBrown = Color(0xFF532814);
const _milkyBackground = Color(0xFFFFFFFF);
const _lightCard = Color(0xFFFFFFFF);
const _lightCardHighlight = Color(0xFFFFE8C2);
const _textDark = Color(0xFF532814);
const _cocoa = Color(0xFF532814);
const _caramel = Color(0xFFFFB814);
const _cream = Color(0xFFFFFFFF);
const _almond = Color(0xFFF2DAA9);
const _sage = Color(0xFF6E7F57);
const _errorRed = Color(0xFFD14343);
const _successGreen = Color(0xFF2F8A55);
const _brandFont = 'Circe';
const _headingFont = 'KulikovSoft';

const _softShadow = [
  BoxShadow(color: Color(0x1F6D3317), blurRadius: 24, offset: Offset(0, 14)),
];

abstract final class BulkaLayout {
  static const floatingNavBarHeight = 98.0;
  static const floatingNavBarHorizontalPadding = 10.0;
  static const floatingNavBarTopPadding = 8.0;
  static const floatingNavBarBottomPadding = 10.0;
  static const navItemHeight = 80.0;
  static const centerNavIconSize = 54.0;
  static const navIconSize = 33.0;
  static const navContentGap = 16.0;

  static double safeBottomInset(BuildContext context) {
    // Safari already removes its browser toolbar from the visual viewport.
    // Applying the same inset again inside Flutter creates a blank strip.
    return kIsWeb ? 0 : MediaQuery.paddingOf(context).bottom;
  }

  static double bottomNavigationExtent(BuildContext context) {
    return floatingNavBarHeight + safeBottomInset(context);
  }

  static double bottomNavContentInset(BuildContext context) {
    return bottomNavigationExtent(context) + navContentGap;
  }
}

@immutable
class BulkaThemeColors extends ThemeExtension<BulkaThemeColors> {
  const BulkaThemeColors({
    required this.brandBrown,
    required this.brandGold,
    required this.goldSoft,
    required this.surfaceCream,
    required this.mutedText,
    required this.cardBorder,
    required this.priceGold,
    required this.success,
    required this.warning,
    required this.danger,
  });

  final Color brandBrown;
  final Color brandGold;
  final Color goldSoft;
  final Color surfaceCream;
  final Color mutedText;
  final Color cardBorder;
  final Color priceGold;
  final Color success;
  final Color warning;
  final Color danger;

  static const light = BulkaThemeColors(
    brandBrown: Color(0xFF6D3317),
    brandGold: _bulkaYellow,
    goldSoft: Color(0xFFDEC588),
    surfaceCream: Color(0xFFFAF6F2),
    mutedText: Color(0xFF7A6C65),
    cardBorder: Color(0xFFEADBBE),
    priceGold: Color(0xFFC8902E),
    success: _successGreen,
    warning: Color(0xFFFFB300),
    danger: _errorRed,
  );

  @override
  BulkaThemeColors copyWith({
    Color? brandBrown,
    Color? brandGold,
    Color? goldSoft,
    Color? surfaceCream,
    Color? mutedText,
    Color? cardBorder,
    Color? priceGold,
    Color? success,
    Color? warning,
    Color? danger,
  }) {
    return BulkaThemeColors(
      brandBrown: brandBrown ?? this.brandBrown,
      brandGold: brandGold ?? this.brandGold,
      goldSoft: goldSoft ?? this.goldSoft,
      surfaceCream: surfaceCream ?? this.surfaceCream,
      mutedText: mutedText ?? this.mutedText,
      cardBorder: cardBorder ?? this.cardBorder,
      priceGold: priceGold ?? this.priceGold,
      success: success ?? this.success,
      warning: warning ?? this.warning,
      danger: danger ?? this.danger,
    );
  }

  @override
  BulkaThemeColors lerp(ThemeExtension<BulkaThemeColors>? other, double t) {
    if (other is! BulkaThemeColors) return this;
    return BulkaThemeColors(
      brandBrown: Color.lerp(brandBrown, other.brandBrown, t)!,
      brandGold: Color.lerp(brandGold, other.brandGold, t)!,
      goldSoft: Color.lerp(goldSoft, other.goldSoft, t)!,
      surfaceCream: Color.lerp(surfaceCream, other.surfaceCream, t)!,
      mutedText: Color.lerp(mutedText, other.mutedText, t)!,
      cardBorder: Color.lerp(cardBorder, other.cardBorder, t)!,
      priceGold: Color.lerp(priceGold, other.priceGold, t)!,
      success: Color.lerp(success, other.success, t)!,
      warning: Color.lerp(warning, other.warning, t)!,
      danger: Color.lerp(danger, other.danger, t)!,
    );
  }
}

extension BulkaThemeExt on BuildContext {
  BulkaThemeColors get bulkaColors {
    return Theme.of(this).extension<BulkaThemeColors>() ??
        BulkaThemeColors.light;
  }
}

ThemeData buildBulkaTheme() {
  return ThemeData(
    useMaterial3: true,
    extensions: const [BulkaThemeColors.light],
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
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: BulkaThemeColors.light.surfaceCream,
      labelStyle: TextStyle(color: _textDark.withValues(alpha: 0.70)),
      floatingLabelStyle: const TextStyle(color: _textDark),
      helperStyle: TextStyle(color: _textDark.withValues(alpha: 0.55)),
      errorStyle: const TextStyle(
        color: _errorRed,
        fontWeight: FontWeight.w600,
      ),
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(color: Color(0xFFEADBBE)),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(color: _bulkaBrown, width: 1.5),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(color: _errorRed),
      ),
      focusedErrorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(color: _errorRed, width: 1.5),
      ),
    ),
    bottomSheetTheme: const BottomSheetThemeData(
      backgroundColor: Colors.transparent,
      surfaceTintColor: Colors.transparent,
      modalBackgroundColor: Colors.transparent,
    ),
    checkboxTheme: CheckboxThemeData(
      fillColor: WidgetStateProperty.resolveWith((states) {
        if (states.contains(WidgetState.selected)) return _bulkaBrown;
        return BulkaThemeColors.light.surfaceCream;
      }),
      checkColor: const WidgetStatePropertyAll(Colors.white),
      side: const BorderSide(color: _bulkaBrown, width: 1.5),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
    ),
    radioTheme: RadioThemeData(
      fillColor: WidgetStateProperty.resolveWith((states) {
        if (states.contains(WidgetState.selected)) return _bulkaBrown;
        return _bulkaBrown.withValues(alpha: 0.70);
      }),
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
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        minimumSize: const Size(0, 48),
        tapTargetSize: MaterialTapTargetSize.padded,
        textStyle: const TextStyle(
          fontFamily: _brandFont,
          fontWeight: FontWeight.w700,
        ),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(0, 48),
        tapTargetSize: MaterialTapTargetSize.padded,
      ),
    ),
  );
}
