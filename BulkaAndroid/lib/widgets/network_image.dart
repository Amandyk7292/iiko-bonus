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
          'quality': '80',
        },
      )
      .toString();
}

int _imagePixelBucket(double pixels) {
  if (!pixels.isFinite || pixels <= 0) return 512;
  if (pixels <= 256) return 256;
  if (pixels <= 512) return 512;
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

class _NetworkImage extends StatelessWidget {
  const _NetworkImage({
    super.key,
    required this.url,
    required this.fit,
    this.semanticLabel,
    this.loadingPlaceholder,
    this.errorPlaceholder,
  });

  final String url;
  final BoxFit fit;
  final String? semanticLabel;
  final Widget? loadingPlaceholder;
  final Widget? errorPlaceholder;

  @override
  Widget build(BuildContext context) {
    if (url.isEmpty) {
      return errorPlaceholder ?? const BulkaImagePlaceholder();
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
                errorBuilder: (_, _, _) =>
                    errorPlaceholder ?? const BulkaImagePlaceholder(),
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
                                const BulkaImagePlaceholder(isLoading: true),
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
                maxWidthDiskCache: pixelWidth,
                maxHeightDiskCache: pixelHeight,
                fadeInDuration: transitionDuration,
                fadeOutDuration: transitionDuration,
                placeholderFadeInDuration: Duration.zero,
                fadeInCurve: BulkaMotion.enterCurve,
                fadeOutCurve: BulkaMotion.exitCurve,
                useOldImageOnUrlChange: true,
                placeholder: (_, _) =>
                    loadingPlaceholder ??
                    const BulkaImagePlaceholder(isLoading: true),
                errorWidget: (_, _, _) =>
                    errorPlaceholder ?? const BulkaImagePlaceholder(),
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

class BulkaImagePlaceholder extends StatefulWidget {
  const BulkaImagePlaceholder({super.key, this.isLoading = false});

  final bool isLoading;

  @override
  State<BulkaImagePlaceholder> createState() => _BulkaImagePlaceholderState();
}

class _BulkaImagePlaceholderState extends State<BulkaImagePlaceholder>
    with SingleTickerProviderStateMixin {
  late final AnimationController _shimmerController;
  bool _isAnimating = false;

  @override
  void initState() {
    super.initState();
    _shimmerController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1100),
    );
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _syncAnimation();
  }

  @override
  void didUpdateWidget(covariant BulkaImagePlaceholder oldWidget) {
    super.didUpdateWidget(oldWidget);
    _syncAnimation();
  }

  void _syncAnimation() {
    final shouldAnimate =
        widget.isLoading &&
        !BulkaMotion.reduced(context) &&
        TickerMode.of(context);
    if (shouldAnimate == _isAnimating) return;
    _isAnimating = shouldAnimate;
    if (shouldAnimate) {
      _shimmerController.repeat();
    } else {
      _shimmerController
        ..stop()
        ..value = 0;
    }
  }

  @override
  void dispose() {
    _shimmerController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final reduceMotion = BulkaMotion.reduced(context);
    return ExcludeSemantics(
      child: RepaintBoundary(
        child: LayoutBuilder(
          builder: (context, constraints) {
            final width =
                constraints.hasBoundedWidth && constraints.maxWidth > 0
                ? constraints.maxWidth
                : 240.0;
            return Stack(
              key: ValueKey(
                widget.isLoading
                    ? 'network-image-loading-placeholder'
                    : 'network-image-error-placeholder',
              ),
              fit: StackFit.expand,
              children: [
                const DecoratedBox(
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: [Color(0xFFFFF9EF), Color(0xFFF2E2CA)],
                    ),
                  ),
                ),
                if (widget.isLoading && !reduceMotion)
                  ClipRect(
                    child: AnimatedBuilder(
                      key: const ValueKey('network-image-shimmer'),
                      animation: _shimmerController,
                      child: FractionallySizedBox(
                        alignment: Alignment.centerLeft,
                        widthFactor: 0.42,
                        child: const DecoratedBox(
                          decoration: BoxDecoration(
                            gradient: LinearGradient(
                              colors: [
                                Color(0x00FFFFFF),
                                Color(0x99FFFFFF),
                                Color(0x00FFFFFF),
                              ],
                            ),
                          ),
                        ),
                      ),
                      builder: (context, child) => Transform.translate(
                        offset: Offset(
                          (-0.55 + _shimmerController.value * 1.9) * width,
                          0,
                        ),
                        child: child,
                      ),
                    ),
                  ),
                Center(
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: 0.72),
                      shape: BoxShape.circle,
                      boxShadow: const [
                        BoxShadow(
                          color: Color(0x1A5A3316),
                          blurRadius: 16,
                          offset: Offset(0, 5),
                        ),
                      ],
                    ),
                    child: SizedBox(
                      width: 48,
                      height: 48,
                      child: Icon(
                        widget.isLoading
                            ? Icons.bakery_dining_rounded
                            : Icons.image_not_supported_rounded,
                        size: 27,
                        color: const Color(0xFFB1773E),
                      ),
                    ),
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}
