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
    return LayoutBuilder(
      builder: (context, constraints) {
        // Decode list thumbnails near their painted size instead of decoding
        // every catalog image at full-screen width. This sharply reduces GPU
        // uploads and memory pressure while scrolling on high-DPI iPhones.
        final viewportWidth = MediaQuery.sizeOf(context).width;
        final logicalWidth = constraints.hasBoundedWidth
            ? constraints.maxWidth
            : viewportWidth;
        final cacheWidth = min(
          2048,
          (logicalWidth * MediaQuery.devicePixelRatioOf(context)).ceil(),
        );
        return SizedBox(
          width: constraints.hasBoundedWidth ? constraints.maxWidth : null,
          height: constraints.hasBoundedHeight ? constraints.maxHeight : null,
          child: Image.network(
            url,
            width: constraints.hasBoundedWidth ? constraints.maxWidth : null,
            height: constraints.hasBoundedHeight ? constraints.maxHeight : null,
            fit: fit,
            cacheWidth: cacheWidth,
            gaplessPlayback: true,
            filterQuality: FilterQuality.medium,
            semanticLabel: semanticLabel,
            errorBuilder: (_, _, _) =>
                const ColoredBox(color: _lightCardHighlight),
            loadingBuilder: (context, child, progress) {
              if (progress == null) return child;
              return const ColoredBox(
                color: _lightCardHighlight,
                child: Center(
                  child: CircularProgressIndicator(color: _bulkaYellow),
                ),
              );
            },
          ),
        );
      },
    );
  }
}
