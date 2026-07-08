part of '../main.dart';

class NewsFeed extends StatelessWidget {
  const NewsFeed({required this.news, super.key});

  final List<NewsItem> news;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Новости',
          style: TextStyle(
            color: _textDark,
            fontFamily: _headingFont,
            fontSize: 24,
            fontWeight: FontWeight.w400,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          'Свежие акции, сезонные вкусы и новости пекарни',
          style: TextStyle(
            color: _textDark.withValues(alpha: 0.58),
            fontSize: 14,
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
    final hasImage = item.imageUrl.isNotEmpty;
    final dateLabel = item.createdAt == null
        ? null
        : formatShortDate(item.createdAt!);

    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: _lightCard,
        borderRadius: BorderRadius.circular(28),
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
                  _NetworkImage(url: item.imageUrl, fit: BoxFit.cover)
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
                          borderRadius: BorderRadius.circular(999),
                        ),
                        child: const Text(
                          'НОВОСТЬ',
                          style: TextStyle(
                            color: _cocoa,
                            fontSize: 11,
                            fontWeight: FontWeight.w900,
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
                            borderRadius: BorderRadius.circular(999),
                            border: Border.all(
                              color: Colors.white.withValues(alpha: 0.22),
                            ),
                          ),
                          child: Text(
                            dateLabel,
                            style: TextStyle(
                              color: hasImage ? Colors.white : _cocoa,
                              fontSize: 11,
                              fontWeight: FontWeight.w800,
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
                  item.title,
                  style: const TextStyle(
                    color: _textDark,
                    fontFamily: _headingFont,
                    fontSize: 20,
                    height: 1.12,
                    fontWeight: FontWeight.w400,
                  ),
                ),
                if ((item.description ?? '').isNotEmpty) ...[
                  const SizedBox(height: 10),
                  Text(
                    item.description!,
                    style: TextStyle(
                      color: _textDark.withValues(alpha: 0.7),
                      fontSize: 15,
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
                    const Expanded(
                      child: Text(
                        'Bulka Bakery',
                        style: TextStyle(
                          color: _cocoa,
                          fontFamily: _headingFont,
                          fontSize: 13,
                          fontWeight: FontWeight.w400,
                        ),
                      ),
                    ),
                    const Icon(
                      Icons.arrow_forward_rounded,
                      color: _caramel,
                      size: 22,
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
                borderRadius: BorderRadius.circular(34),
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
                borderRadius: BorderRadius.circular(20),
              ),
              child: const Icon(
                Icons.bakery_dining_rounded,
                color: _caramel,
                size: 30,
              ),
            ),
          ),
          const Positioned(
            left: 18,
            right: 18,
            bottom: 54,
            child: Text(
              'Свежая новость',
              style: TextStyle(
                color: _cocoa,
                fontFamily: _headingFont,
                fontSize: 28,
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
