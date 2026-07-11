part of '../main.dart';

class _NetworkImage extends StatelessWidget {
  const _NetworkImage({
    required this.url,
    required this.fit,
    this.semanticLabel,
  });

  final String url;
  final BoxFit fit;
  final String? semanticLabel;

  @override
  Widget build(BuildContext context) {
    if (url.isEmpty) {
      return Container(
        color: const Color(0xFFFFF8EE),
        child: const Center(
          child: Icon(
            Icons.restaurant_menu_rounded,
            size: 40,
            color: Color(0xFFDDC9A3),
          ),
        ),
      );
    }
    // A screen-sized decode is sharp enough for the fullscreen story viewer
    // while remaining stable during Hero flights (whose constraints change on
    // every frame). This avoids both oversized source decodes and cache churn.
    final cacheWidth = min(
      2048,
      (MediaQuery.sizeOf(context).width *
              MediaQuery.devicePixelRatioOf(context))
          .ceil(),
    );
    return Image.network(
      url,
      fit: fit,
      cacheWidth: cacheWidth,
      gaplessPlayback: true,
      filterQuality: FilterQuality.medium,
      semanticLabel: semanticLabel,
      errorBuilder: (_, _, _) => const ColoredBox(color: _lightCardHighlight),
      loadingBuilder: (context, child, progress) {
        if (progress == null) return child;
        return const ColoredBox(
          color: _lightCardHighlight,
          child: Center(child: CircularProgressIndicator(color: _bulkaYellow)),
        );
      },
    );
  }
}
