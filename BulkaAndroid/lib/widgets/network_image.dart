part of '../main.dart';

const _supabasePublicImagePath = '/storage/v1/object/public/';
const _supabaseRenderedImagePath = '/storage/v1/render/image/public/';

/// Returns a server-resized Supabase image URL while preserving its aspect
/// ratio. Other image hosts are returned unchanged.
String optimizedNetworkImageUrl(
  String url, {
  required int pixelWidth,
  required int pixelHeight,
  String resizeMode = 'contain',
}) {
  final uri = Uri.tryParse(url);
  if (uri == null ||
      !uri.hasScheme ||
      !(uri.host == 'supabase.co' || uri.host.endsWith('.supabase.co'))) {
    return url;
  }

  final path = uri.path;
  final objectPath = path.startsWith(_supabasePublicImagePath)
      ? path.substring(_supabasePublicImagePath.length)
      : path.startsWith(_supabaseRenderedImagePath)
      ? path.substring(_supabaseRenderedImagePath.length)
      : '';
  if (uri.host == 'owofrgapcxsmzkdsefai.supabase.co' &&
      (objectPath.startsWith('menu_images/') ||
          objectPath.startsWith('stories/'))) {
    return Uri.parse(bulkaApiBaseUrl)
        .resolve('/api/public/image')
        .replace(
          queryParameters: {
            'path': objectPath,
            'edge':
                '${_imagePixelBucket(max(pixelWidth, pixelHeight).toDouble())}',
          },
        )
        .toString();
  }

  final renderedPath = path.contains(_supabasePublicImagePath)
      ? path.replaceFirst(_supabasePublicImagePath, _supabaseRenderedImagePath)
      : path.contains(_supabaseRenderedImagePath)
      ? path
      : null;
  if (renderedPath == null) return url;

  final width = pixelWidth.clamp(1, 1536);
  final height = pixelHeight.clamp(1, 1536);
  final resize = resizeMode == 'cover' ? 'cover' : 'contain';
  return uri
      .replace(
        path: renderedPath,
        queryParameters: {
          ...uri.queryParameters,
          'width': '$width',
          'height': '$height',
          'resize': resize,
          'quality': '95',
        },
      )
      .toString();
}

int _imagePixelBucket(double pixels) {
  if (!pixels.isFinite || pixels <= 0) return 512;
  if (pixels <= 256) return 256;
  if (pixels <= 384) return 384;
  if (pixels <= 512) return 512;
  if (pixels <= 768) return 768;
  if (pixels <= 1024) return 1024;
  return 1536;
}

/// Keeps web downloads sharp without requesting needlessly large renditions on
/// high-density mobile screens. Native apps can retain the larger cache limit.
double networkImageDevicePixelRatio(
  double devicePixelRatio, {
  required bool isWeb,
}) {
  if (!devicePixelRatio.isFinite || devicePixelRatio <= 0) return 1;
  return devicePixelRatio.clamp(1.0, isWeb ? 2.25 : 3.0);
}

/// Matches the provider and ResizeImage key used by CachedNetworkImage/OctoImage.
ImageProvider networkImageCacheProvider(
  String url, {
  required int pixelWidth,
  required int pixelHeight,
  bool isWeb = kIsWeb,
}) => isWeb
    ? NetworkImage(url)
    : ResizeImage.resizeIfNeeded(
        pixelWidth,
        pixelHeight,
        CachedNetworkImageProvider(url),
      );

class _PhotoLoadingIndicator extends StatelessWidget {
  const _PhotoLoadingIndicator();

  @override
  Widget build(BuildContext context) => const Center(
    child: CupertinoActivityIndicator(radius: 12, color: Color(0xFF782B0E)),
  );
}

class _NetworkImage extends StatelessWidget {
  const _NetworkImage({
    super.key,
    required this.url,
    required this.fit,
    this.semanticLabel,
    this.loadingPlaceholder,
    this.errorPlaceholder,
    this.onError,
  });

  final String url;
  final BoxFit fit;
  final String? semanticLabel;
  final Widget? loadingPlaceholder;
  final Widget? errorPlaceholder;
  final VoidCallback? onError;

  Widget _failedImage() {
    if (onError != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) => onError?.call());
    }
    return errorPlaceholder ?? const SizedBox.shrink();
  }

  @override
  Widget build(BuildContext context) {
    if (url.isEmpty) {
      return _failedImage();
    }
    return LayoutBuilder(
      builder: (context, constraints) {
        final media = MediaQuery.of(context);
        final devicePixelRatio = networkImageDevicePixelRatio(
          media.devicePixelRatio,
          isWeb: kIsWeb,
        );
        final logicalWidth =
            constraints.hasBoundedWidth && constraints.maxWidth > 0
            ? constraints.maxWidth
            : media.size.width;
        final logicalHeight =
            constraints.hasBoundedHeight && constraints.maxHeight > 0
            ? constraints.maxHeight
            : media.size.height;
        final pixelWidth = _imagePixelBucket(logicalWidth * devicePixelRatio);
        final pixelHeight = _imagePixelBucket(logicalHeight * devicePixelRatio);
        // Resize at the CDN on every platform. Native cache dimensions only
        // reduce decoded memory; without this URL transform Android and iOS
        // still download the full original file. Buckets also prevent Hero
        // flights from creating a cache entry on every animation frame.
        final effectiveUrl = optimizedNetworkImageUrl(
          url,
          pixelWidth: pixelWidth,
          pixelHeight: pixelHeight,
          resizeMode: fit == BoxFit.cover ? 'cover' : 'contain',
        );
        final transitionDuration = BulkaMotion.duration(
          context,
          BulkaMotion.fast,
        );
        final image = kIsWeb
            ? Image.network(
                effectiveUrl,
                width: constraints.hasBoundedWidth
                    ? constraints.maxWidth
                    : null,
                height: constraints.hasBoundedHeight
                    ? constraints.maxHeight
                    : null,
                fit: fit,
                gaplessPlayback: true,
                filterQuality: FilterQuality.medium,
                semanticLabel: semanticLabel,
                errorBuilder: (_, _, _) => effectiveUrl == url
                    ? _failedImage()
                    : Image.network(
                        url,
                        fit: fit,
                        semanticLabel: semanticLabel,
                        frameBuilder: (_, child, frame, synchronous) =>
                            synchronous || frame != null
                            ? child
                            : (loadingPlaceholder ??
                                  const _PhotoLoadingIndicator()),
                        errorBuilder: (_, _, _) => _failedImage(),
                      ),
                frameBuilder: (context, child, frame, wasSynchronouslyLoaded) {
                  if (wasSynchronouslyLoaded) return child;
                  final loaded = frame != null;
                  return Stack(
                    fit: StackFit.expand,
                    children: [
                      Positioned.fill(
                        child: TickerMode(
                          enabled: !loaded,
                          child: AnimatedOpacity(
                            opacity: loaded ? 0 : 1,
                            duration: transitionDuration,
                            curve: BulkaMotion.exitCurve,
                            child:
                                loadingPlaceholder ??
                                const _PhotoLoadingIndicator(),
                          ),
                        ),
                      ),
                      Positioned.fill(
                        child: AnimatedOpacity(
                          opacity: loaded ? 1 : 0,
                          duration: transitionDuration,
                          curve: BulkaMotion.enterCurve,
                          child: child,
                        ),
                      ),
                    ],
                  );
                },
              )
            : CachedNetworkImage(
                imageUrl: effectiveUrl,
                fit: fit,
                memCacheWidth: pixelWidth,
                memCacheHeight: pixelHeight,
                fadeInDuration: transitionDuration,
                fadeOutDuration: transitionDuration,
                placeholderFadeInDuration: Duration.zero,
                fadeInCurve: BulkaMotion.enterCurve,
                fadeOutCurve: BulkaMotion.exitCurve,
                useOldImageOnUrlChange: true,
                placeholder: (_, _) =>
                    loadingPlaceholder ?? const _PhotoLoadingIndicator(),
                errorWidget: (_, _, _) => effectiveUrl == url
                    ? _failedImage()
                    : CachedNetworkImage(
                        imageUrl: url,
                        fit: fit,
                        placeholder: (_, _) =>
                            loadingPlaceholder ??
                            const _PhotoLoadingIndicator(),
                        errorWidget: (_, _, _) => _failedImage(),
                      ),
                imageBuilder: (context, provider) => Image(
                  image: provider,
                  width: constraints.hasBoundedWidth
                      ? constraints.maxWidth
                      : null,
                  height: constraints.hasBoundedHeight
                      ? constraints.maxHeight
                      : null,
                  fit: fit,
                  filterQuality: FilterQuality.medium,
                  semanticLabel: semanticLabel,
                ),
              );
        return SizedBox(
          width: constraints.hasBoundedWidth ? constraints.maxWidth : null,
          height: constraints.hasBoundedHeight ? constraints.maxHeight : null,
          child: image,
        );
      },
    );
  }
}
