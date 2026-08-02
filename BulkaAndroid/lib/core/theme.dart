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
const _mutedText = Color(0xFF7A6C65);
const _errorRed = Color(0xFFD14343);
const _successGreen = Color(0xFF2B7A4B);
// Keep the customer interface on exactly two locally bundled typefaces.
// Golos Text is the display/control face with native Kazakh Cyrillic support;
// Montserrat is for readable descriptions, supporting copy and secondary labels.
const _headingFont = 'GolosText';
const _descriptionFont = 'Montserrat';

/// The single type style for every screen title.
///
/// These values intentionally match the catalog title, which is the visual
/// reference for the rest of the application.
const _bulkaPageTitleTextStyle = TextStyle(
  color: _textDark,
  fontFamily: _headingFont,
  fontSize: BulkaTypeScale.pageTitle,
  fontWeight: FontWeight.w400,
);

class _BulkaPageTitle extends StatelessWidget {
  const _BulkaPageTitle(this.text, {this.color, super.key});

  final String text;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      header: true,
      label: text,
      excludeSemantics: true,
      child: Text(
        text,
        maxLines: 2,
        softWrap: true,
        overflow: TextOverflow.ellipsis,
        textAlign: TextAlign.center,
        textWidthBasis: TextWidthBasis.longestLine,
        style: _bulkaPageTitleTextStyle.copyWith(
          color: color ?? Theme.of(context).colorScheme.onSurface,
          height: 1.08,
        ),
      ),
    );
  }
}

const _softShadow = [
  BoxShadow(color: Color(0x1F6D3317), blurRadius: 24, offset: Offset(0, 14)),
];

/// Shared type scale for the whole client application.
///
/// Keep one optical scale instead of introducing one-off half-pixel values in
/// individual screens. Golos Text is used for headings/actions and Montserrat
/// for descriptions; the size tokens are shared by both families.
abstract final class BulkaTypeScale {
  static const badge = 10.0;
  static const caption = 12.0;
  static const bodySmall = 14.0;
  static const body = 16.0;
  static const titleSmall = 18.0;
  static const title = 20.0;
  static const titleLarge = 24.0;
  static const pageTitle = 28.0;
  static const display = 34.0;
}

/// Consistent shape language: small details, controls, cards, sheets and pills.
abstract final class BulkaRadii {
  static const small = 8.0;
  static const control = 18.0;
  static const card = 24.0;
  static const sheet = 32.0;
  static const pill = 999.0;
}

abstract final class BulkaTouch {
  static const minimum = 44.0;
  static const button = 50.0;
  static const primaryButton = 56.0;
}

abstract final class BulkaLayout {
  static const appBarSideSlot = 56.0;
  static const floatingNavBarHeight = 88.0;
  static const compactNavBarHeight = 70.0;
  static const floatingNavBarHorizontalPadding = 10.0;
  static const floatingNavBarTopPadding = 6.0;
  static const floatingNavBarBottomPadding = 8.0;
  static const navItemHeight = 74.0;
  static const compactNavItemHeight = 64.0;
  static const centerNavIconSize = 50.0;
  static const navIconSize = 31.0;
  static const navContentGap = 10.0;

  static bool compactNavigation(BuildContext context) =>
      MediaQuery.sizeOf(context).height < 500;

  /// Gives two-line, dynamically scaled page titles enough vertical room
  /// without shrinking the user's requested text size.
  static double appBarHeight(BuildContext context) {
    final scale = MediaQuery.textScalerOf(context).scale(1);
    if (scale <= 1.1) return 64;
    return (72 * scale).clamp(72, 144).toDouble();
  }

  static double navigationBarHeight(BuildContext context) =>
      compactNavigation(context) ? compactNavBarHeight : floatingNavBarHeight;

  static double safeBottomInset(BuildContext context) {
    // Safari already removes its browser toolbar from the visual viewport.
    // Applying the same inset again inside Flutter creates a blank strip.
    return kIsWeb ? 0 : MediaQuery.paddingOf(context).bottom;
  }

  static double bottomNavigationExtent(BuildContext context) {
    return navigationBarHeight(context) + safeBottomInset(context);
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
    required this.skeletonBase,
    required this.skeletonHighlight,
    required this.disabledSurface,
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
  final Color skeletonBase;
  final Color skeletonHighlight;
  final Color disabledSurface;
  final Color success;
  final Color warning;
  final Color danger;

  static const light = BulkaThemeColors(
    brandBrown: Color(0xFF6D3317),
    brandGold: _bulkaYellow,
    goldSoft: Color(0xFFDEC588),
    surfaceCream: Colors.white,
    mutedText: _mutedText,
    cardBorder: Color(0xFFEADBBE),
    priceGold: Color(0xFFC8902E),
    skeletonBase: Color(0xFFF0EBE3),
    skeletonHighlight: Color(0xFFFFFBF5),
    disabledSurface: Color(0xFFF5F1EA),
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
    Color? skeletonBase,
    Color? skeletonHighlight,
    Color? disabledSurface,
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
      skeletonBase: skeletonBase ?? this.skeletonBase,
      skeletonHighlight: skeletonHighlight ?? this.skeletonHighlight,
      disabledSurface: disabledSurface ?? this.disabledSurface,
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
      skeletonBase: Color.lerp(skeletonBase, other.skeletonBase, t)!,
      skeletonHighlight: Color.lerp(
        skeletonHighlight,
        other.skeletonHighlight,
        t,
      )!,
      disabledSurface: Color.lerp(disabledSurface, other.disabledSurface, t)!,
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

WidgetStateProperty<Color?> _bulkaButtonOverlay(Color color) {
  return WidgetStateProperty.resolveWith((states) {
    if (states.contains(WidgetState.pressed)) {
      return color.withValues(alpha: 0.12);
    }
    if (states.contains(WidgetState.focused)) {
      return color.withValues(alpha: 0.09);
    }
    if (states.contains(WidgetState.hovered)) {
      return color.withValues(alpha: 0.06);
    }
    return null;
  });
}

ThemeData buildBulkaTheme() {
  return ThemeData(
    useMaterial3: true,
    splashFactory: NoSplash.splashFactory,
    highlightColor: _bulkaBrown.withValues(alpha: 0.055),
    hoverColor: _bulkaBrown.withValues(alpha: 0.035),
    focusColor: _bulkaBrown.withValues(alpha: 0.075),
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
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: const Color(0xFF3F1D0E),
      elevation: 8,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(BulkaRadii.control),
      ),
      contentTextStyle: const TextStyle(
        color: Colors.white,
        fontFamily: _descriptionFont,
        fontSize: BulkaTypeScale.bodySmall,
        fontWeight: FontWeight.w600,
      ),
      actionTextColor: const Color(0xFFFFD36A),
    ),
    progressIndicatorTheme: const ProgressIndicatorThemeData(
      color: _bulkaYellow,
      circularTrackColor: Color(0xFFF3E3C5),
      linearTrackColor: Color(0xFFF3E3C5),
    ),
    textSelectionTheme: TextSelectionThemeData(
      cursorColor: _bulkaBrown,
      selectionColor: _bulkaYellow.withValues(alpha: 0.34),
      selectionHandleColor: _bulkaBrown,
    ),
    tooltipTheme: TooltipThemeData(
      decoration: BoxDecoration(
        color: const Color(0xFF3F1D0E),
        borderRadius: BorderRadius.circular(BulkaRadii.small),
      ),
      textStyle: const TextStyle(
        color: Colors.white,
        fontFamily: _descriptionFont,
        fontSize: BulkaTypeScale.bodySmall,
        fontWeight: FontWeight.w600,
      ),
      waitDuration: const Duration(milliseconds: 450),
    ),
    fontFamily: _descriptionFont,
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
        fontFamily: _descriptionFont,
        fontWeight: FontWeight.w400,
      ),
      bodyMedium: TextStyle(
        color: _textDark,
        fontFamily: _descriptionFont,
        fontWeight: FontWeight.w400,
      ),
      bodySmall: TextStyle(
        color: _textDark,
        fontFamily: _descriptionFont,
        fontWeight: FontWeight.w400,
      ),
      labelLarge: TextStyle(
        color: _textDark,
        fontFamily: _descriptionFont,
        fontWeight: FontWeight.w400,
      ),
      labelMedium: TextStyle(
        color: _textDark,
        fontFamily: _descriptionFont,
        fontWeight: FontWeight.w600,
      ),
      labelSmall: TextStyle(
        color: _textDark,
        fontFamily: _descriptionFont,
        fontWeight: FontWeight.w500,
      ),
    ),
    appBarTheme: const AppBarTheme(
      centerTitle: true,
      elevation: 0,
      backgroundColor: Colors.transparent,
      foregroundColor: _textDark,
      surfaceTintColor: Colors.transparent,
      titleTextStyle: _bulkaPageTitleTextStyle,
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
      fillColor: Colors.white,
      labelStyle: TextStyle(
        color: _textDark.withValues(alpha: 0.70),
        fontFamily: _descriptionFont,
      ),
      floatingLabelStyle: const TextStyle(
        color: _textDark,
        fontFamily: _descriptionFont,
      ),
      helperStyle: const TextStyle(
        color: _mutedText,
        fontFamily: _descriptionFont,
      ),
      errorStyle: const TextStyle(
        color: _errorRed,
        fontFamily: _descriptionFont,
        fontWeight: FontWeight.w600,
      ),
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(BulkaRadii.control),
        borderSide: const BorderSide(color: Color(0xFFEADBBE)),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(BulkaRadii.control),
        borderSide: const BorderSide(color: _bulkaBrown, width: 1.5),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(BulkaRadii.control),
        borderSide: const BorderSide(color: _errorRed),
      ),
      focusedErrorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(BulkaRadii.control),
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
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(BulkaRadii.small),
      ),
    ),
    radioTheme: RadioThemeData(
      fillColor: WidgetStateProperty.resolveWith((states) {
        if (states.contains(WidgetState.selected)) return _bulkaBrown;
        return _bulkaBrown.withValues(alpha: 0.70);
      }),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: ButtonStyle(
        minimumSize: const WidgetStatePropertyAll(
          Size(0, BulkaTouch.primaryButton),
        ),
        tapTargetSize: MaterialTapTargetSize.padded,
        animationDuration: BulkaMotion.fast,
        enableFeedback: true,
        foregroundColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.disabled)) {
            return _textDark.withValues(alpha: 0.38);
          }
          return _bulkaBrown;
        }),
        backgroundColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.disabled)) {
            return _bulkaYellow.withValues(alpha: 0.30);
          }
          return _bulkaYellow;
        }),
        overlayColor: _bulkaButtonOverlay(_bulkaBrown),
        elevation: const WidgetStatePropertyAll(0),
        shadowColor: WidgetStatePropertyAll(
          _bulkaBrown.withValues(alpha: 0.14),
        ),
        padding: const WidgetStatePropertyAll(
          EdgeInsets.symmetric(horizontal: 22, vertical: 14),
        ),
        textStyle: const WidgetStatePropertyAll(
          TextStyle(
            fontFamily: _headingFont,
            fontSize: BulkaTypeScale.body,
            fontWeight: FontWeight.w700,
            letterSpacing: -0.1,
          ),
        ),
        shape: WidgetStatePropertyAll(
          RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(BulkaRadii.control),
          ),
        ),
      ),
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ButtonStyle(
        minimumSize: const WidgetStatePropertyAll(Size(0, BulkaTouch.button)),
        tapTargetSize: MaterialTapTargetSize.padded,
        animationDuration: BulkaMotion.fast,
        enableFeedback: true,
        foregroundColor: const WidgetStatePropertyAll(_bulkaBrown),
        backgroundColor: const WidgetStatePropertyAll(Colors.white),
        overlayColor: _bulkaButtonOverlay(_bulkaBrown),
        elevation: const WidgetStatePropertyAll(0),
        surfaceTintColor: const WidgetStatePropertyAll(Colors.transparent),
        shadowColor: WidgetStatePropertyAll(
          _bulkaBrown.withValues(alpha: 0.12),
        ),
        padding: const WidgetStatePropertyAll(
          EdgeInsets.symmetric(horizontal: 20, vertical: 13),
        ),
        textStyle: const WidgetStatePropertyAll(
          TextStyle(
            fontFamily: _headingFont,
            fontSize: BulkaTypeScale.body,
            fontWeight: FontWeight.w700,
            letterSpacing: -0.1,
          ),
        ),
        shape: WidgetStatePropertyAll(
          RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(BulkaRadii.control),
          ),
        ),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: ButtonStyle(
        minimumSize: const WidgetStatePropertyAll(Size(0, BulkaTouch.button)),
        tapTargetSize: MaterialTapTargetSize.padded,
        animationDuration: BulkaMotion.fast,
        enableFeedback: true,
        foregroundColor: const WidgetStatePropertyAll(_bulkaBrown),
        backgroundColor: const WidgetStatePropertyAll(Colors.white),
        overlayColor: _bulkaButtonOverlay(_bulkaBrown),
        padding: const WidgetStatePropertyAll(
          EdgeInsets.symmetric(horizontal: 20, vertical: 13),
        ),
        side: const WidgetStatePropertyAll(
          BorderSide(color: Color(0xFFE7D8BA), width: 1),
        ),
        textStyle: const WidgetStatePropertyAll(
          TextStyle(
            fontFamily: _headingFont,
            fontSize: BulkaTypeScale.body,
            fontWeight: FontWeight.w600,
          ),
        ),
        shape: WidgetStatePropertyAll(
          RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(BulkaRadii.control),
          ),
        ),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: ButtonStyle(
        minimumSize: const WidgetStatePropertyAll(
          Size.square(BulkaTouch.minimum),
        ),
        tapTargetSize: MaterialTapTargetSize.padded,
        animationDuration: BulkaMotion.fast,
        enableFeedback: true,
        foregroundColor: const WidgetStatePropertyAll(_bulkaBrown),
        overlayColor: _bulkaButtonOverlay(_bulkaBrown),
        textStyle: const WidgetStatePropertyAll(
          TextStyle(
            fontFamily: _headingFont,
            fontSize: BulkaTypeScale.body,
            fontWeight: FontWeight.w700,
          ),
        ),
        shape: WidgetStatePropertyAll(
          RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(BulkaRadii.control),
          ),
        ),
      ),
    ),
    iconButtonTheme: IconButtonThemeData(
      style: ButtonStyle(
        minimumSize: const WidgetStatePropertyAll(
          Size.square(BulkaTouch.minimum),
        ),
        tapTargetSize: MaterialTapTargetSize.padded,
        animationDuration: BulkaMotion.fast,
        enableFeedback: true,
        foregroundColor: const WidgetStatePropertyAll(_bulkaBrown),
        overlayColor: _bulkaButtonOverlay(_bulkaBrown),
        shape: const WidgetStatePropertyAll(CircleBorder()),
      ),
    ),
  );
}
