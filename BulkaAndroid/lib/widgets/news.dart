part of '../main.dart';

class NewsFeed extends StatelessWidget {
  const NewsFeed({required this.news, super.key});

  final List<NewsItem> news;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'news_title'.tr,
          style: const TextStyle(
            color: _textDark,
            fontFamily: _headingFont,
            fontSize: BulkaTypeScale.titleLarge,
            fontWeight: FontWeight.w400,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          'news_sub'.tr,
          style: TextStyle(
            color: _textDark.withValues(alpha: 0.58),
            fontSize: BulkaTypeScale.bodySmall,
            height: 1.3,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 16),
        for (final item in news) ...[
          NewsCard(item: item),
          const SizedBox(height: 16),
        ],
      ],
    );
  }
}

class NewsCard extends StatelessWidget {
  const NewsCard({required this.item, super.key});

  final NewsItem item;

  @override
  Widget build(BuildContext context) {
    final imageUrl = item.localizedImageUrl;
    final title = item.localizedTitle;
    final description = item.localizedDescription;
    final hasImage = imageUrl.isNotEmpty;
    final dateLabel = item.createdAt == null
        ? null
        : formatShortDate(item.createdAt!);

    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: _lightCard,
        borderRadius: BorderRadius.circular(BulkaRadii.card),
        border: Border.all(color: Colors.white.withValues(alpha: 0.9)),
        boxShadow: [
          BoxShadow(
            color: _cocoa.withValues(alpha: 0.08),
            blurRadius: 26,
            offset: const Offset(0, 16),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            height: 190,
            width: double.infinity,
            child: Stack(
              fit: StackFit.expand,
              children: [
                if (hasImage)
                  _NetworkImage(
                    url: imageUrl,
                    fit: BoxFit.cover,
                    semanticLabel: title,
                  )
                else
                  const _NewsFallbackBanner(),
                if (hasImage)
                  DecoratedBox(
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        begin: Alignment.topCenter,
                        end: Alignment.bottomCenter,
                        colors: [
                          Colors.black.withValues(alpha: 0.02),
                          Colors.black.withValues(alpha: 0.28),
                        ],
                      ),
                    ),
                  ),
                Positioned(
                  left: 16,
                  right: 16,
                  bottom: 16,
                  child: Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 12,
                          vertical: 7,
                        ),
                        decoration: BoxDecoration(
                          color: _lightCard.withValues(alpha: 0.92),
                          borderRadius: BorderRadius.circular(BulkaRadii.pill),
                        ),
                        child: Text(
                          'news_badge'.tr,
                          style: const TextStyle(
                            fontFamily: _headingFont,
                            color: _cocoa,
                            fontSize: BulkaTypeScale.caption,
                            fontWeight: FontWeight.w700,
                            letterSpacing: 0.4,
                          ),
                        ),
                      ),
                      if (dateLabel != null) ...[
                        const SizedBox(width: 8),
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 12,
                            vertical: 7,
                          ),
                          decoration: BoxDecoration(
                            color: hasImage
                                ? Colors.black.withValues(alpha: 0.36)
                                : _cocoa.withValues(alpha: 0.12),
                            borderRadius: BorderRadius.circular(
                              BulkaRadii.pill,
                            ),
                            border: Border.all(
                              color: Colors.white.withValues(alpha: 0.22),
                            ),
                          ),
                          child: Text(
                            dateLabel,
                            style: TextStyle(
                              fontFamily: _headingFont,
                              color: hasImage ? Colors.white : _cocoa,
                              fontSize: BulkaTypeScale.caption,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(18, 18, 18, 20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    color: _textDark,
                    fontFamily: _headingFont,
                    fontSize: BulkaTypeScale.title,
                    height: 1.12,
                    fontWeight: FontWeight.w400,
                  ),
                ),
                if ((description ?? '').isNotEmpty) ...[
                  const SizedBox(height: 10),
                  Text(
                    description!,
                    style: TextStyle(
                      color: _textDark.withValues(alpha: 0.7),
                      fontSize: BulkaTypeScale.body,
                      height: 1.48,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ],
                const SizedBox(height: 16),
                Row(
                  children: [
                    Container(
                      width: 40,
                      height: 40,
                      decoration: const BoxDecoration(
                        color: _lightCardHighlight,
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(
                        Icons.bakery_dining_rounded,
                        color: _caramel,
                        size: 22,
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        'app_title'.tr,
                        style: const TextStyle(
                          color: _cocoa,
                          fontFamily: _headingFont,
                          fontSize: BulkaTypeScale.bodySmall,
                          fontWeight: FontWeight.w400,
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _NewsFallbackBanner extends StatelessWidget {
  const _NewsFallbackBanner();

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFFFFE082), Color(0xFFFFD54F), Color(0xFFFFB300)],
          stops: [0, 0.52, 1],
        ),
      ),
      child: Stack(
        children: [
          Positioned(
            right: -30,
            top: -24,
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.2),
                borderRadius: BorderRadius.circular(BulkaRadii.sheet),
              ),
              child: const SizedBox(width: 112, height: 112),
            ),
          ),
          Positioned(
            right: -28,
            top: -18,
            child: Icon(
              Icons.local_cafe_rounded,
              size: 148,
              color: _cocoa.withValues(alpha: 0.08),
            ),
          ),
          Positioned(
            left: 18,
            top: 18,
            child: Container(
              width: 58,
              height: 58,
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.92),
                borderRadius: BorderRadius.circular(BulkaRadii.control),
              ),
              child: const Icon(
                Icons.bakery_dining_rounded,
                color: _caramel,
                size: 30,
              ),
            ),
          ),
          Positioned(
            left: 18,
            right: 18,
            bottom: 54,
            child: Text(
              'fresh_news_fallback'.tr,
              style: const TextStyle(
                color: _cocoa,
                fontFamily: _headingFont,
                fontSize: BulkaTypeScale.pageTitle,
                height: 1,
                fontWeight: FontWeight.w400,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
