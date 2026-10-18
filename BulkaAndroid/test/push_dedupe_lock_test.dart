import 'dart:async';
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
  test('a failing action releases queued and later lock users', () async {
    final entered = Completer<void>();
    final release = Completer<void>();
    final events = <String>[];
    final failing = PushDedupeLock.synchronized(() async {
      events.add('first');
      entered.complete();
      await release.future;
      throw StateError('fixture action failed');
    });
    final failed = expectLater(failing, throwsStateError);
    await entered.future;
    final following = PushDedupeLock.synchronized(() async {
      events.add('second');
    });
    expect(events, ['first']);
    release.complete();
    await failed;
    await following;
    await PushDedupeLock.synchronized(() async => events.add('third'));
    expect(events, ['first', 'second', 'third']);
  });

  test(
    'caller timeout does not release a still-running critical section',
    () async {
      final entered = Completer<void>();
      final release = Completer<void>();
      var nextEntered = false;
      final running = PushDedupeLock.synchronized(() async {
        entered.complete();
        await release.future;
      });
      await entered.future;
      final following = PushDedupeLock.synchronized(() async {
        nextEntered = true;
      });
      await expectLater(
        running.timeout(const Duration(milliseconds: 20)),
        throwsA(isA<TimeoutException>()),
      );
      expect(nextEntered, false);
      release.complete();
      await Future.wait([running, following]);
      expect(nextEntered, true);
    },
  );

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
