part of '../main.dart';

String _catalogCopyKey(String value) =>
    value.trim().replaceAll(RegExp(r'\s+'), ' ').toLowerCase();

final _catalogCopies = <String, Map<String, String>>{
  for (final row in _catalogCopyRows.trim().split('\n'))
    for (final value in row.trim().split('|'))
      _catalogCopyKey(value): Map.fromIterables([
        'ru',
        'kk',
        'en',
      ], row.trim().split('|')),
};

String localizeCatalogName(String value) =>
    _catalogCopies[_catalogCopyKey(value)]?[AppLang.current] ?? value;
