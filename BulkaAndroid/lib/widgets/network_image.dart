part of '../main.dart';

class _NetworkImage extends StatelessWidget {
  const _NetworkImage({required this.url, required this.fit});

  final String url;
  final BoxFit fit;

  @override
  Widget build(BuildContext context) {
    if (url.isEmpty) return const ColoredBox(color: _lightCardHighlight);
    return Image.network(
      url,
      fit: fit,
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
