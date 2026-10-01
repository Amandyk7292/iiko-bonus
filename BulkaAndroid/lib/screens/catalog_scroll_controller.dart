part of '../main.dart';

extension _CatalogScrollNavigation on _CatalogScreenState {
  double? get _catalogFeedStart {
    final render = _catalogFeedKey.currentContext?.findRenderObject();
    return render is RenderSliver
        ? render.constraints.precedingScrollExtent
        : null;
  }

  void _scheduleCatalogScrollSync() {
    if (_catalogSyncScheduled) return;
    _catalogSyncScheduled = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _catalogSyncScheduled = false;
      if (!mounted || !_catalogScrollController.hasClients) return;
      final category = _pendingCategoryScroll;
      if (category != null &&
          (category == _catalogAllCategoryKey || _catalogFeedStart != null)) {
        _pendingCategoryScroll = null;
        unawaited(_scrollCatalogToCategory(category));
      } else {
        _syncCatalogActiveCategory();
      }
    });
  }

  Future<void> _scrollCatalogToCategory(String category) async {
    if (!mounted || !_catalogScrollController.hasClients) return;
    final offset = _catalogFeedLayout?.categoryOffsets[category];
    if (category != _catalogAllCategoryKey && offset == null) return;
    final position = _catalogScrollController.position;
    final desired = category == _catalogAllCategoryKey
        ? 0.0
        : _catalogFeedStart! + offset! - _catalogHeaderExtent;
    final target = desired.clamp(0.0, position.maxScrollExtent);
    _catalogClampedSelection = (desired - target).abs() > 0.5
        ? (category: category, offset: target)
        : null;
    final revision = ++_catalogJumpRevision;
    _catalogIsJumping = true;
    _activeCatalogCategory.value = category;
    _revealActiveCategoryChip(category);
    try {
      if (BulkaMotion.reduced(context)) {
        _catalogScrollController.jumpTo(target);
      } else {
        await _catalogScrollController.animateTo(
          target,
          duration: const Duration(milliseconds: 260),
          curve: Curves.easeOutCubic,
        );
      }
    } finally {
      if (mounted && revision == _catalogJumpRevision) {
        _catalogIsJumping = false;
        _syncCatalogActiveCategory();
      }
    }
  }

  void _syncCatalogActiveCategory() {
    if (!mounted || _catalogIsJumping || !_catalogScrollController.hasClients) {
      return;
    }
    final feed = _catalogFeedLayout;
    final start = _catalogFeedStart;
    if (feed == null || start == null || feed.categoryOffsets.isEmpty) return;
    final position = _catalogScrollController.position;
    final clamped = _catalogClampedSelection;
    if (clamped != null && (position.pixels - clamped.offset).abs() < 1) {
      return;
    }
    _catalogClampedSelection = null;
    final offset = position.pixels + _catalogHeaderExtent - start + 8;
    var category = _catalogAllCategoryKey;
    for (final section in feed.categoryOffsets.entries) {
      if (section.value > offset) break;
      category = section.key;
    }
    if (position.pixels > 0 &&
        position.pixels >= position.maxScrollExtent - 1) {
      category = feed.categoryOffsets.keys.last;
    }
    if (category == _activeCatalogCategory.value) return;
    _activeCatalogCategory.value = category;
    _revealActiveCategoryChip(category);
  }

  void _revealActiveCategoryChip(String category) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted ||
          !_categoryStripController.hasClients ||
          _activeCatalogCategory.value != category) {
        return;
      }
      final render = _categoryChipKeys[category]?.currentContext
          ?.findRenderObject();
      if (render == null || !render.attached) return;
      unawaited(
        _categoryStripController.position.ensureVisible(
          render,
          alignment: 0.1,
          duration: BulkaMotion.reduced(context)
              ? Duration.zero
              : const Duration(milliseconds: 160),
          curve: Curves.easeOutCubic,
        ),
      );
    });
  }
}
