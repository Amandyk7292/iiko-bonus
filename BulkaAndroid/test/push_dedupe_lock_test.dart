import 'dart:io';
import 'dart:isolate';

import 'package:bulka_bonus/core/push_dedupe_lock.dart';
import 'package:flutter_test/flutter_test.dart';

Future<void> _incrementUnderPushLock(String counterPath) =>
    PushDedupeLock.synchronized(() async {
      final counter = File(counterPath);
      final current = int.parse(await counter.readAsString());
      // Widen the read/write race so this test fails deterministically if two
      // isolates are ever allowed into the critical section together.
      await Future<void>.delayed(const Duration(milliseconds: 8));
      await counter.writeAsString('${current + 1}', flush: true);
    });

void main() {
  test('push lock serializes main and background isolate claims', () async {
    final directory = await Directory.systemTemp.createTemp(
      'bulka-push-lock-test-',
    );
    final counter = File('${directory.path}${Platform.pathSeparator}counter');
    await counter.writeAsString('0', flush: true);
    try {
      await Future.wait(
        List<Future<void>>.generate(
          12,
          (_) => Isolate.run(() => _incrementUnderPushLock(counter.path)),
        ),
      );
      expect(await counter.readAsString(), '12');
    } finally {
      await directory.delete(recursive: true);
    }
  });
}
