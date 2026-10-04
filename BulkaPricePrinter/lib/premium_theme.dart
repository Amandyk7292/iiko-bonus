import 'package:flutter/material.dart';

const _brown = Color(0xff532b18);
const _gold = LinearGradient(
  begin: Alignment.topLeft,
  end: Alignment.bottomRight,
  colors: [Color(0xffffe19a), Color(0xffffca46), Color(0xfff5b31f)],
  stops: [0, 0.48, 1],
);
const _ivory = LinearGradient(
  begin: Alignment.topLeft,
  end: Alignment.bottomRight,
  colors: [Color(0xfffffffd), Color(0xfffffaef), Color(0xfff5ebd8)],
);

Widget _finish(Set<WidgetState> states, Widget? child, Gradient gradient) =>
    Ink(
      decoration: BoxDecoration(
        gradient: states.contains(WidgetState.disabled)
            ? const LinearGradient(
                colors: [Color(0xfff2ede4), Color(0xffe7e1d7)],
              )
            : gradient,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: states.contains(WidgetState.focused)
              ? _brown
              : const Color(0xffe2c995),
          width: states.contains(WidgetState.focused) ? 1.6 : 0.8,
        ),
      ),
      child: child ?? const SizedBox.shrink(),
    );

ThemeData buildPrinterTheme() {
  final style = ButtonStyle(
    foregroundColor: WidgetStateProperty.resolveWith(
      (states) => states.contains(WidgetState.disabled)
          ? const Color(0xff8a7c6b)
          : _brown,
    ),
    minimumSize: const WidgetStatePropertyAll(Size(48, 48)),
    shape: WidgetStatePropertyAll(
      RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
    ),
    textStyle: const WidgetStatePropertyAll(
      TextStyle(fontFamily: 'Segoe UI', fontWeight: FontWeight.w600),
    ),
  );
  final primary = style.copyWith(
    backgroundBuilder: (_, states, child) => _finish(states, child, _gold),
  );
  final secondary = style.copyWith(
    backgroundBuilder: (_, states, child) => _finish(states, child, _ivory),
  );
  return ThemeData(
    fontFamily: 'Segoe UI',
    colorScheme: ColorScheme.fromSeed(
      seedColor: const Color(0xffffb300),
      primary: _brown,
    ),
    scaffoldBackgroundColor: const Color(0xfffffbf4),
    useMaterial3: true,
    filledButtonTheme: FilledButtonThemeData(style: primary),
    elevatedButtonTheme: ElevatedButtonThemeData(style: primary),
    outlinedButtonTheme: OutlinedButtonThemeData(style: secondary),
    iconButtonTheme: IconButtonThemeData(style: secondary),
    inputDecorationTheme: InputDecorationTheme(
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(16)),
      filled: true,
      fillColor: Colors.white,
    ),
  );
}
