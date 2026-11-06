import 'package:flutter/foundation.dart';

final _values = Expando<_MemoizedValue>();

class _MemoizedValue {
  const _MemoizedValue(this.inputs, this.value);
  final List<Object?> inputs;
  final Object? value;
}

/// One cached computation per owner, discarded when the owner is collected.
/// Inputs must be replaced rather than mutated when their contents change.
T memoizedInput<T>(Object owner, List<Object?> inputs, T Function() compute) {
  final cached = _values[owner];
  if (cached != null && listEquals(cached.inputs, inputs)) {
    return cached.value as T;
  }
  final value = compute();
  _values[owner] = _MemoizedValue(inputs, value);
  return value;
}
