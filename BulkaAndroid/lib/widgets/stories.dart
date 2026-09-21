part of '../main.dart';

const _storyPreviewWidth = 104.0;
const _storyPreviewHeight = 116.0;
const _promoCoverAspectRatio = 1080 / 480;

class StoryGroup {
  const StoryGroup({
    required this.id,
    required this.title,
    required this.coverUrl,
    required this.stories,
    this.subtitle,
    this.viewed = false,
  });

  final String id;
  final String title;
  final String coverUrl;
  final List<PromoStory> stories;
  final String? subtitle;
  final bool viewed;
}

class PromoBannerShimmer extends StatefulWidget {
  const PromoBannerShimmer({super.key});

  @override
  State<PromoBannerShimmer> createState() => _PromoBannerShimmerState();
}

class _PromoBannerShimmerState extends State<PromoBannerShimmer>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  bool _reduceMotion = false;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1400),
    );
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final reduceMotion = BulkaMotion.reduced(context);
    if (reduceMotion == _reduceMotion && _controller.isAnimating) return;
    _reduceMotion = reduceMotion;
    if (_reduceMotion) {
      _controller.stop();
      _controller.value = 0.5;
    } else if (!_controller.isAnimating) {
      _controller.repeat();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final shimmer = _reduceMotion ? null : _controller;
    return SizedBox(
      height: _storyPreviewHeight,
      child: ListView.separated(
        padding: const EdgeInsets.symmetric(horizontal: 16),
        scrollDirection: Axis.horizontal,
        physics: const NeverScrollableScrollPhysics(),
        itemCount: 3,
        separatorBuilder: (_, _) => const SizedBox(width: 10),
        itemBuilder: (_, _) =>
            SizedBox(width: _storyPreviewWidth, child: _buildCard(shimmer)),
      ),
    );
  }

  Widget _buildCard(Animation<double>? animation) {
    final colors = context.bulkaColors;
    final content = Padding(
      padding: const EdgeInsets.all(22),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          _skeletonLine(180, 22, 8, const Color(0xFFE8E3DA)),
          const SizedBox(height: 12),
          _skeletonLine(240, 14, 6, colors.skeletonBase),
          const SizedBox(height: 8),
          _skeletonLine(140, 14, 6, colors.skeletonBase),
        ],
      ),
    );

    Widget decorated(double value, Widget child) => DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(BulkaRadii.card),
        border: Border.all(
          color: const Color(0xFF6D3317).withValues(alpha: 0.10),
        ),
        gradient: LinearGradient(
          begin: Alignment(-2.0 + 4.0 * value, -0.5),
          end: Alignment(-1.0 + 4.0 * value, 0.5),
          colors: const [
            Color(0xFFFFFFFF),
            Color(0xFFFAFAF7),
            Color(0xFFFFE8C2),
            Color(0xFFFAFAF7),
            Color(0xFFFFFFFF),
          ],
          stops: const [0.0, 0.35, 0.5, 0.65, 1.0],
        ),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0C000000),
            blurRadius: 16,
            offset: Offset(0, 4),
          ),
        ],
      ),
      child: child,
    );

    return SizedBox.expand(
      child: ClipRRect(
        borderRadius: BorderRadius.circular(BulkaRadii.card),
        clipBehavior: Clip.antiAlias,
        child: animation == null
            ? decorated(0.5, content)
            : AnimatedBuilder(
                animation: animation,
                child: content,
                builder: (context, child) => decorated(animation.value, child!),
              ),
      ),
    );
  }

  Widget _skeletonLine(
    double width,
    double height,
    double radius,
    Color color,
  ) {
    return Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(radius),
      ),
    );
  }
}

class PromoBannerSlider extends StatefulWidget {
  const PromoBannerSlider({
    required this.groups,
    required this.onGroupTap,
    super.key,
  });

  final List<StoryGroup> groups;
  final ValueChanged<StoryGroup> onGroupTap;

  @override
  State<PromoBannerSlider> createState() => _PromoBannerSliderState();
}

class _PromoBannerSliderState extends State<PromoBannerSlider> {
  @override
  Widget build(BuildContext context) {
    if (widget.groups.isEmpty) return const SizedBox.shrink();

    return SizedBox(
      height: _storyPreviewHeight,
      child: ListView.separated(
        key: const ValueKey('home-stories-list'),
        padding: const EdgeInsets.symmetric(horizontal: 16),
        scrollDirection: Axis.horizontal,
        physics: const BouncingScrollPhysics(),
        itemCount: widget.groups.length,
        separatorBuilder: (_, _) => const SizedBox(width: 10),
        itemBuilder: (context, index) => SizedBox(
          width: _storyPreviewWidth,
          child: _PromoBannerCard(
            group: widget.groups[index],
            onTap: () => widget.onGroupTap(widget.groups[index]),
          ),
        ),
      ),
    );
  }
}

class _PromoBannerCard extends StatelessWidget {
  const _PromoBannerCard({required this.group, required this.onTap});

  final StoryGroup group;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: 'story_open'.trArgs({'title': group.title}),
      child: BulkaHero(
        tag: 'promo-${group.id}',
        child: BulkaPressScale(
          child: Material(
            color: Colors.transparent,
            child: InkWell(
              key: ValueKey('promo-card-${group.id}'),
              onTap: () {
                BulkaMotion.lightImpact();
                onTap();
              },
              borderRadius: BorderRadius.circular(BulkaRadii.control),
              child: AnimatedContainer(
                duration: BulkaMotion.duration(context, BulkaMotion.fast),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(BulkaRadii.control),
                  boxShadow: BulkaShadows.card,
                ),
                foregroundDecoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(BulkaRadii.control),
                  border: Border.all(
                    color: group.viewed
                        ? const Color(0xFFB8B8B8)
                        : const Color(0xFF782B0E),
                    width: 2,
                  ),
                ),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(BulkaRadii.control),
                  child: _BannerFullCoverWidget(group: group),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _BannerFullCoverWidget extends StatelessWidget {
  const _BannerFullCoverWidget({required this.group});

  final StoryGroup group;

  @override
  Widget build(BuildContext context) {
    final storyUrl = group.stories.isEmpty
        ? group.coverUrl
        : _storyImageUrl(group.stories.first);
    if (storyUrl.startsWith('http')) {
      return _NetworkImage(
        key: ValueKey('promo-image-${group.id}'),
        url: storyUrl,
        fit: BoxFit.cover,
      );
    }
    return Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF4A2210), Color(0xFF231007)],
        ),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(
                  group.title.toUpperCase(),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontFamily: _headingFont,
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                    color: Color(0xFFEADBBE),
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  group.subtitle ?? 'story_offer_fallback'.tr,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: BulkaTypeScale.bodySmall,
                    color: Colors.white70,
                    height: 1.25,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
