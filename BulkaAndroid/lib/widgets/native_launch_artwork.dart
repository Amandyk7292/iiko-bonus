part of '../main.dart';

/// Shows the local launch artwork only while real initialization is pending.
class BulkaInitializationView extends StatelessWidget {
  const BulkaInitializationView({
    required this.initialization,
    required this.child,
    this.isWeb = kIsWeb,
    super.key,
  });

  final Future<void> initialization;
  final Widget child;
  final bool isWeb;

  @override
  Widget build(BuildContext context) => FutureBuilder<void>(
    future: initialization,
    builder: (context, snapshot) {
      if (snapshot.connectionState == ConnectionState.done) return child;
      return isWeb
          ? const SizedBox.shrink()
          : const NativeLaunchArtwork(holdFirstFrame: true);
    },
  );
}

/// Uses the supplied launch artwork without changing the logo's proportions.
class NativeLaunchArtwork extends StatefulWidget {
  const NativeLaunchArtwork({this.holdFirstFrame = false, super.key});

  static const asset = 'assets/brand/bulka-launch.png';
  static const background = Color(0xFFFFB329);
  final bool holdFirstFrame;

  @override
  State<NativeLaunchArtwork> createState() => _NativeLaunchArtworkState();
}

class _NativeLaunchArtworkState extends State<NativeLaunchArtwork> {
  bool _holdingFirstFrame = false;

  @override
  void initState() {
    super.initState();
    if (!kIsWeb && widget.holdFirstFrame) {
      // Retain the OS surface until the local PNG is decoded, avoiding a blank
      // first Flutter frame. This has no effect after the first frame is sent.
      WidgetsBinding.instance.deferFirstFrame();
      _holdingFirstFrame = true;
    }
  }

  void _releaseFirstFrame() {
    if (!_holdingFirstFrame) return;
    _holdingFirstFrame = false;
    scheduleMicrotask(WidgetsBinding.instance.allowFirstFrame);
  }

  @override
  void dispose() {
    // Initialization may finish before decoding; ready UI must appear then.
    _releaseFirstFrame();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => ColoredBox(
    color: NativeLaunchArtwork.background,
    child: SizedBox.expand(
      child: Image.asset(
        NativeLaunchArtwork.asset,
        fit: BoxFit.cover,
        excludeFromSemantics: true,
        frameBuilder: (context, child, frame, wasSynchronouslyLoaded) {
          if (frame != null) _releaseFirstFrame();
          return child;
        },
        errorBuilder: (context, error, stackTrace) {
          _releaseFirstFrame();
          return const SizedBox.expand();
        },
      ),
    ),
  );
}
