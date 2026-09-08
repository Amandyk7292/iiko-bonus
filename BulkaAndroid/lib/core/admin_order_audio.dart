import 'dart:async';
import 'package:audio_session/audio_session.dart';
import 'package:just_audio/just_audio.dart';

/// Plays the kitchen alert through the OS audio session, outside WebKit.
class AdminOrderAudio {
  AudioPlayer? _player;
  Future<void>? _loading;
  Timer? _stopTimer;
  int _generation = 0;
  bool _disposed = false;

  Future<void> prepare() async {
    if (_disposed) throw StateError('Audio closed');
    if (_loading != null) return _loading;
    final player = _player ??= AudioPlayer();
    _loading = player
        .setAsset('assets/audio/staff-order-alarm.wav')
        .then((_) {});
    try {
      await _loading;
    } catch (_) {
      _loading = null;
      rethrow;
    }
  }

  Future<void> play({
    required bool kitchen,
    required void Function() onError,
  }) async {
    final generation = ++_generation;
    _stopTimer?.cancel();
    await prepare();
    final session = await AudioSession.instance;
    await session.configure(const AudioSessionConfiguration.music());
    if (_disposed || generation != _generation) return;
    final player = _player!;
    await player.seek(Duration.zero);
    if (_disposed || generation != _generation) return;
    unawaited(
      player.play().catchError((Object _) {
        if (!_disposed && generation == _generation) onError();
      }),
    );
    _stopTimer = Timer(
      kitchen ? const Duration(seconds: 10) : const Duration(milliseconds: 800),
      () {
        if (generation == _generation) unawaited(stop());
      },
    );
  }

  Future<void> stop() async {
    _generation++;
    _stopTimer?.cancel();
    await _player?.pause();
  }

  Future<void> dispose() async {
    _disposed = true;
    _generation++;
    _stopTimer?.cancel();
    await _player?.dispose();
  }
}
