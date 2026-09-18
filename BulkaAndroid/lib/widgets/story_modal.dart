part of '../main.dart';

class PromoModalViewer extends StatelessWidget {
  const PromoModalViewer({required this.group, super.key});

  final StoryGroup group;

  @override
  Widget build(BuildContext context) {
    final story = group.stories.isNotEmpty ? group.stories.first : null;
    final title = group.title;
    final subtitle =
        group.subtitle ??
        story?.localizedDescription ??
        story?.localizedTitle ??
        'story_offer_fallback'.tr;
    final isHappy = group.id == 'happy_hours' || title.contains('2+1');

    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
              child: Stack(
                alignment: Alignment.center,
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 18,
                      vertical: 7,
                    ),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(BulkaRadii.control),
                      border: Border.all(color: const Color(0xFFEADBBE)),
                      boxShadow: [
                        BoxShadow(
                          color: const Color(
                            0xFF6D3317,
                          ).withValues(alpha: 0.05),
                          blurRadius: 8,
                          offset: const Offset(0, 2),
                        ),
                      ],
                    ),
                    child: const Text(
                      'Bulka Cafe & Bakery',
                      style: TextStyle(
                        fontFamily: _headingFont,
                        fontSize: BulkaTypeScale.bodySmall,
                        fontWeight: FontWeight.w700,
                        color: Color(0xFF5A2A18),
                      ),
                    ),
                  ),
                  Align(
                    alignment: Alignment.centerRight,
                    child: IconButton(
                      onPressed: () => Navigator.of(context).maybePop(),
                      tooltip: 'close_tooltip'.tr,
                      icon: const Icon(
                        Icons.close,
                        color: Color(0xFF5A2A18),
                        size: 26,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.symmetric(
                  horizontal: 28,
                  vertical: 16,
                ),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const SizedBox(height: 12),
                    Text(
                      title.toUpperCase(),
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        fontFamily: _headingFont,
                        fontSize: BulkaTypeScale.titleLarge,
                        fontWeight: FontWeight.w700,
                        color: Color(0xFF4A2210),
                        height: 1.15,
                      ),
                    ),
                    const SizedBox(height: 12),
                    Text(
                      subtitle,
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        fontSize: BulkaTypeScale.body,
                        color: Color(0xFF7D5034),
                        height: 1.35,
                      ),
                    ),
                    const SizedBox(height: 32),
                    Container(
                      height: 220,
                      width: double.infinity,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: const Color(0xFFFFFBF4),
                        borderRadius: BorderRadius.circular(BulkaRadii.card),
                        border: Border.all(
                          color: const Color(0xFFEADBBE),
                          width: 1.2,
                        ),
                      ),
                      child:
                          (story != null &&
                              story.localizedContentUrl.startsWith('http'))
                          ? ClipRRect(
                              borderRadius: BorderRadius.circular(
                                BulkaRadii.card,
                              ),
                              child: _NetworkImage(
                                url: story.localizedContentUrl,
                                fit: BoxFit.cover,
                              ),
                            )
                          : Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Text(
                                  isHappy ? '2 + 1' : 'story_gift'.tr,
                                  style: TextStyle(
                                    fontFamily: _headingFont,
                                    fontSize: isHappy ? 64 : 68,
                                    fontWeight: FontWeight.w700,
                                    color: const Color(0xFFD38B28),
                                  ),
                                ),
                                const SizedBox(height: 8),
                                Text(
                                  subtitle,
                                  style: const TextStyle(
                                    fontFamily: _headingFont,
                                    fontSize: BulkaTypeScale.bodySmall,
                                    fontWeight: FontWeight.w700,
                                    color: Color(0xFF8B5E3C),
                                  ),
                                ),
                              ],
                            ),
                    ),
                  ],
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(28, 0, 28, 20),
              child: Column(
                children: [
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton(
                      onPressed: () => Navigator.of(context).push<void>(
                        MaterialPageRoute(
                          builder: (_) => const LocationsScreen(),
                        ),
                      ),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFFDCAE68),
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.symmetric(vertical: 16),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(BulkaRadii.card),
                        ),
                        elevation: 0,
                      ),
                      child: Text(
                        'catalog_action'.tr,
                        style: const TextStyle(
                          fontFamily: _headingFont,
                          fontSize: BulkaTypeScale.body,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

const _desktopStoryBreakpoint = 900.0;
const _desktopStoryMaxWidth = 540.0;
const _desktopStoryMaxHeight = 960.0;
const _storyPortraitAspectRatio = 9 / 16;

bool _usesDesktopStoryLayout(Size viewport) =>
    viewport.width >= _desktopStoryBreakpoint;

Size _storyRenderSize(Size viewport) {
  if (!_usesDesktopStoryLayout(viewport)) return viewport;
  final availableWidth = max(
    1.0,
    min(_desktopStoryMaxWidth, viewport.width - 160),
  );
  final availableHeight = max(
    1.0,
    min(_desktopStoryMaxHeight, viewport.height - 32),
  );
  final width = min(
    availableWidth,
    availableHeight * _storyPortraitAspectRatio,
  );
  return Size(width, width / _storyPortraitAspectRatio);
}

class _DesktopStoryViewport extends StatelessWidget {
  const _DesktopStoryViewport({
    required this.story,
    required this.onDismiss,
    required this.child,
  });

  final PromoStory story;
  final VoidCallback onDismiss;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final frameSize = _storyRenderSize(constraints.biggest);
        const radius = BorderRadius.all(Radius.circular(26));
        return Stack(
          fit: StackFit.expand,
          children: [
            Semantics(
              button: true,
              label: 'close_tooltip'.tr,
              child: GestureDetector(
                behavior: HitTestBehavior.opaque,
                onTap: onDismiss,
                child: _DesktopStoryBackdrop(story: story),
              ),
            ),
            Center(
              child: SizedBox(
                key: const ValueKey('story-desktop-frame'),
                width: frameSize.width,
                height: frameSize.height,
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    color: Colors.black,
                    borderRadius: radius,
                    border: Border.all(
                      color: Colors.white.withValues(alpha: 0.16),
                    ),
                    boxShadow: const [
                      BoxShadow(
                        color: Color(0x990F0704),
                        blurRadius: 48,
                        spreadRadius: 2,
                        offset: Offset(0, 18),
                      ),
                    ],
                  ),
                  child: Padding(
                    padding: const EdgeInsets.all(1),
                    child: ClipRRect(
                      borderRadius: const BorderRadius.all(Radius.circular(25)),
                      child: child,
                    ),
                  ),
                ),
              ),
            ),
          ],
        );
      },
    );
  }
}

class _DesktopStoryBackdrop extends StatelessWidget {
  const _DesktopStoryBackdrop({required this.story});

  final PromoStory story;

  @override
  Widget build(BuildContext context) {
    final url = _storyImageUrl(story);
    return ExcludeSemantics(
      child: Stack(
        key: const ValueKey('story-desktop-backdrop'),
        fit: StackFit.expand,
        children: [
          const ColoredBox(color: Color(0xFF1B0D08)),
          if (url.startsWith('http'))
            Opacity(
              opacity: 0.24,
              child: ImageFiltered(
                imageFilter: ui.ImageFilter.blur(sigmaX: 32, sigmaY: 32),
                child: Transform.scale(
                  scale: 1.08,
                  child: _NetworkImage(
                    url: url,
                    fit: BoxFit.cover,
                    loadingPlaceholder: const SizedBox.expand(),
                    errorPlaceholder: const SizedBox.expand(),
                  ),
                ),
              ),
            ),
          const DecoratedBox(
            decoration: BoxDecoration(
              gradient: RadialGradient(
                radius: 1.05,
                colors: [Color(0x221F1009), Color(0xE6140906)],
                stops: [0.18, 1],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
