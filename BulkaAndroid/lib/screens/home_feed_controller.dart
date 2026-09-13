part of '../main.dart';

extension _HomeFeedController on _HomeScreenState {
  Future<void> _initializeFeed() async {
    try {
      await _loadCachedFeed();
    } catch (_) {
      // Local storage failure must not prevent the live feed from loading.
    }
    if (mounted) await _loadFeed();
  }

  Future<void> _loadCachedFeed() async {
    final prefs = await SharedPreferences.getInstance();
    if (!mounted) return;
    final cachedStories = prefs.getString('cached_stories_json');
    if (cachedStories != null && _stories.isEmpty) {
      try {
        final decoded = jsonDecode(cachedStories) as List<dynamic>;
        _updateHomeState(() {
          _stories = decoded
              .map((e) => PromoStory.fromJson(_asMap(e)))
              .toList();
          _initialLoading = false;
        });
      } catch (_) {}
    }
  }

  Future<void> _loadViewedStoryGroups() async {
    final prefs = await SharedPreferences.getInstance();
    if (!mounted) return;
    _updateHomeState(() {
      _viewedStoryGroups =
          (prefs.getStringList('viewed_story_groups') ?? const []).toSet();
    });
  }

  Future<void> _loadFeed() async {
    if (!mounted || _feedLoading) return;
    _feedLoading = true;
    try {
      await _loadStories();
    } finally {
      _feedLoading = false;
    }
  }

  Future<void> _loadStories() async {
    try {
      final stories = await widget.api.getStories();
      if (!mounted) return;
      _updateHomeState(() {
        _stories = stories;
        _storiesLoadFailed = false;
        _initialLoading = false;
      });
      await _saveFeedCache(
        'cached_stories_json',
        stories.map((story) => story.toJson()).toList(),
      );
    } catch (_) {
      if (!mounted) return;
      _updateHomeState(() {
        _storiesLoadFailed = true;
        _initialLoading = false;
      });
    }
  }

  Future<void> _saveFeedCache(String key, List<Object?> items) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(key, jsonEncode(items));
    } catch (_) {
      // The successfully loaded feed remains usable without local storage.
    }
  }
}
