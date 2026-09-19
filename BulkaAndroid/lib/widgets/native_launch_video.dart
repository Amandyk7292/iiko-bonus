part of '../main.dart';

/// Plays the supplied launch animation once while the native app initializes
/// behind it. Flutter Web deliberately bypasses this gate.
class NativeLaunchVideoGate extends StatefulWidget {
  const NativeLaunchVideoGate({required this.child, super.key});

  final Widget child;

  @override
  State<NativeLaunchVideoGate> createState() => _NativeLaunchVideoGateState();
}

class _NativeLaunchVideoGateState extends State<NativeLaunchVideoGate> {
  static const _duration = Duration(seconds: 5);
  late final VideoPlayerController _controller;
  Timer? _timer;
  bool _ready = false;
  bool _finished = false;

  @override
  void initState() {
    super.initState();
    _controller = VideoPlayerController.asset(
      'assets/brand/launch_animation.mp4',
      videoPlayerOptions: VideoPlayerOptions(mixWithOthers: true),
    );
    unawaited(_start());
  }

  Future<void> _start() async {
    try {
      await _controller.initialize();
      await _controller.setVolume(0);
      await _controller.setLooping(false);
      if (!mounted) return;
      setState(() => _ready = true);
      await _controller.play();
    } catch (error) {
      debugPrint('Launch animation unavailable: ${error.runtimeType}');
    } finally {
      if (mounted) {
        _timer = Timer(_duration, () {
          if (mounted) setState(() => _finished = true);
        });
      }
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    unawaited(_controller.dispose());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Stack(
      fit: StackFit.expand,
      children: [
        widget.child,
        if (!_finished)
          ColoredBox(
            color: const Color(0xFFFFB329),
            child: _ready
                ? FittedBox(
                    fit: BoxFit.cover,
                    clipBehavior: Clip.hardEdge,
                    child: SizedBox(
                      width: _controller.value.size.width,
                      height: _controller.value.size.height,
                      child: VideoPlayer(_controller),
                    ),
                  )
                : const SizedBox.expand(),
          ),
      ],
    );
  }
}
