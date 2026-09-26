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
  VideoPlayerController? _controller;
  Timer? _timer;
  bool _ready = false;
  bool _finished = false;

  @override
  void initState() {
    super.initState();
    unawaited(_start());
  }

  Future<void> _start() async {
    io.File? file;
    try {
      // The download can finish in the background for the next launch.
      file = await launchVideoCache.load().timeout(const Duration(seconds: 2));
      if (!mounted || _finished) return;
      final controller = VideoPlayerController.file(
        file,
        videoPlayerOptions: VideoPlayerOptions(mixWithOthers: true),
      );
      _controller = controller;
      await controller.initialize().timeout(const Duration(seconds: 2));
      if (!mounted || _finished) return;
      await controller.setVolume(0);
      await controller.setLooping(false);
      if (!mounted || _finished) return;
      setState(() => _ready = true);
      _timer = Timer(const Duration(seconds: 4), _finish);
      controller.addListener(() {
        if (controller.value.hasError ||
            (controller.value.isInitialized &&
                controller.value.position >= controller.value.duration)) {
          _finish();
        }
      });
      await controller.play();
    } catch (error) {
      debugPrint('Launch animation unavailable: ${error.runtimeType}');
      if (file != null && error is! TimeoutException) {
        try {
          if (await file.exists()) await file.delete();
        } catch (_) {
          // A cache failure must never prevent the customer entering the app.
        }
      }
      _finish();
    }
  }

  void _finish() {
    if (!mounted || _finished) return;
    _timer?.cancel();
    final controller = _controller;
    _controller = null;
    setState(() => _finished = true);
    // The gate lives as long as the app; release decoder/texture resources now.
    unawaited(controller?.dispose());
  }

  @override
  void dispose() {
    _timer?.cancel();
    unawaited(_controller?.dispose());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Stack(
      alignment: Alignment.center,
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
                      width: _controller!.value.size.width,
                      height: _controller!.value.size.height,
                      child: VideoPlayer(_controller!),
                    ),
                  )
                : const SizedBox.expand(),
          ),
      ],
    );
  }
}
