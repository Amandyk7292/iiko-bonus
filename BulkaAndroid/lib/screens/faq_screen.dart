part of '../main.dart';

class FaqScreen extends StatefulWidget {
  const FaqScreen({required this.api, super.key});
  final BulkaApiClient api;

  @override
  State<FaqScreen> createState() => _FaqScreenState();
}

class _FaqScreenState extends State<FaqScreen> {
  List<FaqItem> _items = const [];
  final Set<String> _expanded = {};
  bool _loading = true;
  bool _failed = false;
  int _requestRevision = 0;

  @override
  void initState() {
    super.initState();
    appLanguageNotifier.addListener(_onLanguageChanged);
    unawaited(_load());
  }

  @override
  void didUpdateWidget(covariant FaqScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.api != widget.api) unawaited(_load());
  }

  @override
  void dispose() {
    appLanguageNotifier.removeListener(_onLanguageChanged);
    _requestRevision++;
    super.dispose();
  }

  void _onLanguageChanged() {
    _expanded.clear();
    unawaited(_load());
  }

  Future<void> _load({bool refresh = false}) async {
    final revision = ++_requestRevision;
    final language = AppLang.current;
    setState(() {
      _loading = true;
      _failed = false;
      _items = const [];
    });
    try {
      final items = await widget.api.getPublicFaq(
        language: language,
        refresh: refresh,
      );
      if (!mounted || revision != _requestRevision) return;
      setState(() {
        _items = items;
        _expanded.removeWhere((id) => !items.any((item) => item.id == id));
        _loading = false;
      });
    } catch (_) {
      if (!mounted || revision != _requestRevision) return;
      setState(() {
        _failed = true;
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    return Scaffold(
      key: const ValueKey('faq-screen'),
      backgroundColor: colors.brandGold,
      appBar: AppBar(
        backgroundColor: colors.brandGold,
        toolbarHeight: BulkaLayout.appBarHeight(context),
        title: Image.asset(
          'assets/brand/bulka_logo.png',
          width: 100,
          height: 44,
          fit: BoxFit.contain,
          semanticLabel: 'Bulka',
        ),
        actions: [
          IconButton(
            key: const ValueKey('faq-refresh'),
            tooltip: 'faq_refresh'.tr,
            onPressed: _loading ? null : () => unawaited(_load(refresh: true)),
            icon: const Icon(Icons.refresh_rounded),
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: DecoratedBox(
        decoration: const BoxDecoration(
          image: DecorationImage(
            image: AssetImage('assets/brand/loyalty_background.jpg'),
            fit: BoxFit.cover,
            opacity: 0.28,
          ),
        ),
        child: SafeArea(
          top: false,
          child: RefreshIndicator(
            color: colors.brandBrown,
            onRefresh: () => _load(refresh: true),
            child: ListView(
              key: const PageStorageKey('faq-scroll'),
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
              children: [
                Align(
                  alignment: Alignment.topCenter,
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 640),
                    child: Material(
                      color: colors.surfaceCream,
                      borderRadius: BorderRadius.circular(BulkaRadii.card),
                      clipBehavior: Clip.antiAlias,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Padding(
                            padding: const EdgeInsets.fromLTRB(20, 24, 20, 12),
                            child: Semantics(
                              header: true,
                              child: Text(
                                'faq_title'.tr,
                                style: TextStyle(
                                  fontFamily: _headingFont,
                                  fontSize: BulkaTypeScale.titleLarge,
                                  color: colors.brandBrown,
                                  height: 1.2,
                                ),
                              ),
                            ),
                          ),
                          if (_loading)
                            _FaqStatus(message: 'faq_loading'.tr, loading: true)
                          else if (_failed)
                            _FaqStatus(
                              message: 'faq_load_error'.tr,
                              actionLabel: 'faq_retry'.tr,
                              onAction: () => unawaited(_load(refresh: true)),
                            )
                          else if (_items.isEmpty)
                            _FaqStatus(
                              message: 'faq_empty'.tr,
                              actionLabel: 'faq_refresh'.tr,
                              onAction: () => unawaited(_load(refresh: true)),
                            )
                          else ...[
                            for (final item in _items)
                              _FaqQuestion(
                                key: ValueKey('faq-item-${item.id}'),
                                item: item,
                                expanded: _expanded.contains(item.id),
                                onToggle: () => setState(() {
                                  if (!_expanded.add(item.id)) {
                                    _expanded.remove(item.id);
                                  }
                                }),
                              ),
                            const SizedBox(height: 12),
                          ],
                        ],
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _FaqStatus extends StatelessWidget {
  const _FaqStatus({
    required this.message,
    this.loading = false,
    this.actionLabel,
    this.onAction,
  });
  final String message;
  final bool loading;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(20, 24, 20, 32),
    child: Column(
      children: [
        if (loading) ...[
          const SizedBox.square(
            dimension: 28,
            child: CircularProgressIndicator(strokeWidth: 2.5),
          ),
          const SizedBox(height: 16),
        ],
        Semantics(
          liveRegion: true,
          child: Text(
            message,
            textAlign: TextAlign.center,
            style: TextStyle(
              color: context.bulkaColors.mutedText,
              fontSize: BulkaTypeScale.body,
              height: 1.5,
            ),
          ),
        ),
        if (onAction != null) ...[
          const SizedBox(height: 16),
          OutlinedButton(
            key: const ValueKey('faq-retry'),
            onPressed: onAction,
            style: OutlinedButton.styleFrom(
              minimumSize: const Size(BulkaTouch.minimum, 48),
            ),
            child: Text(actionLabel!),
          ),
        ],
      ],
    ),
  );
}

class _FaqQuestion extends StatelessWidget {
  const _FaqQuestion({
    required this.item,
    required this.expanded,
    required this.onToggle,
    super.key,
  });

  final FaqItem item;
  final bool expanded;
  final VoidCallback onToggle;

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    final answer = expanded
        ? Padding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
            child: Text(
              item.answer,
              key: ValueKey('faq-answer-${item.id}'),
              style: TextStyle(
                color: colors.mutedText,
                fontSize: BulkaTypeScale.body,
                height: 1.5,
              ),
            ),
          )
        : const SizedBox(width: double.infinity);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Semantics(
          key: ValueKey('faq-question-semantics-${item.id}'),
          button: true,
          expanded: expanded,
          label: item.question,
          onTap: onToggle,
          excludeSemantics: true,
          child: InkWell(
            key: ValueKey('faq-question-${item.id}'),
            onTap: onToggle,
            excludeFromSemantics: true,
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: 64),
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: 20,
                  vertical: 18,
                ),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        item.question,
                        style: TextStyle(
                          color: colors.brandBrown,
                          fontFamily: _headingFont,
                          fontSize: BulkaTypeScale.body,
                          height: 1.35,
                        ),
                      ),
                    ),
                    const SizedBox(width: 16),
                    Container(
                      width: 32,
                      height: 32,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        border: Border.all(
                          color: colors.brandBrown,
                          width: 1.5,
                        ),
                      ),
                      child: Icon(
                        expanded ? Icons.remove_rounded : Icons.add_rounded,
                        color: colors.brandBrown,
                        size: 22,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
        if (BulkaMotion.reduced(context))
          answer
        else
          AnimatedSize(
            duration: const Duration(milliseconds: 200),
            alignment: Alignment.topCenter,
            curve: Curves.easeOutCubic,
            child: answer,
          ),
      ],
    );
  }
}
