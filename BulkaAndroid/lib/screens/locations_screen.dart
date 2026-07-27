part of '../main.dart';

class LocationsScreen extends StatefulWidget {
  const LocationsScreen({this.orderType = 'pickup', super.key});

  final String orderType;

  @override
  State<LocationsScreen> createState() => _LocationsScreenState();
}

class _LocationsScreenState extends State<LocationsScreen> {
  bool _showCities = false;
  String _selectedCity = '';
  String _searchQuery = '';
  bool _loading = true;
  bool _loadFailed = false;

  Map<String, List<BakeryLocation>> _cityLocations = {};

  @override
  void initState() {
    super.initState();
    _loadLocations();
  }

  Future<void> _loadLocations() async {
    if (mounted) {
      setState(() {
        _loading = true;
        _loadFailed = false;
      });
    }
    try {
      final api = BulkaApiClient();
      final locations = await api.getFulfillmentLocations();
      final locs = <String, List<BakeryLocation>>{};
      for (final location in locations) {
        if (!location.supports(widget.orderType)) continue;
        final city = location.city.trim().isEmpty
            ? 'locations_other_city'.tr
            : location.city.trim();
        locs.putIfAbsent(city, () => []).add(location);
      }
      if (!mounted) return;
      setState(() {
        _cityLocations = locs;
        if (_cityLocations.isNotEmpty &&
            !_cityLocations.containsKey(_selectedCity)) {
          _selectedCity = _cityLocations.keys.first;
        }
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _loadFailed = true;
        _cityLocations = {};
      });
    }
  }

  void _onCityTapped(String city) {
    setState(() {
      _selectedCity = city;
      _showCities = false;
      _searchQuery = '';
    });
  }

  Future<void> _onLocationTapped(BakeryLocation location) async {
    final prefs = await SharedPreferences.getInstance();
    if (location.id.isEmpty) {
      await prefs.remove('selected_bakery_location_id');
    } else {
      await prefs.setString('selected_bakery_location_id', location.id);
    }
    await prefs.setString('selected_bakery_location', location.displayLabel);
    await prefs.setString(
      'selected_bakery_location_${widget.orderType}',
      location.displayLabel,
    );
    if (location.id.isEmpty) {
      await prefs.remove('selected_bakery_location_id_${widget.orderType}');
    } else {
      await prefs.setString(
        'selected_bakery_location_id_${widget.orderType}',
        location.id,
      );
    }
    if (mounted) Navigator.of(context).pop(location.displayLabel);
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    final scheme = Theme.of(context).colorScheme;
    final locations = _cityLocations[_selectedCity] ?? [];
    final filteredLocations = locations
        .where(
          (loc) => loc.displayLabel.toLowerCase().contains(
            _searchQuery.toLowerCase(),
          ),
        )
        .toList();

    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      appBar: AppBar(
        toolbarHeight: BulkaLayout.appBarHeight(context),
        backgroundColor: scheme.surface,
        centerTitle: true,
        leading: IconButton(
          onPressed: () {
            if (_showCities) {
              setState(() => _showCities = false);
            } else {
              Navigator.of(context).pop();
            }
          },
          icon: const Icon(Icons.chevron_left_rounded, size: 34),
          color: colors.mutedText,
          tooltip: 'back_tooltip'.tr,
        ),
        title: _BulkaPageTitle('locations_title'.tr, color: scheme.onSurface),
        actions: const [SizedBox(width: BulkaLayout.appBarSideSlot)],
        elevation: 0,
      ),
      body: SafeArea(
        child: _loading
            ? const Center(
                child: CircularProgressIndicator(color: Colors.orange),
              )
            : _loadFailed
            ? _LocationsState(
                icon: Icons.cloud_off_rounded,
                title: 'locations_error'.tr,
                actionLabel: 'retry_btn'.tr,
                onAction: _loadLocations,
              )
            : (_showCities
                  ? _buildCitiesList()
                  : _buildLocationsList(filteredLocations)),
      ),
    );
  }

  Widget _buildCitiesList() {
    final colors = context.bulkaColors;
    final scheme = Theme.of(context).colorScheme;
    final cities = _cityLocations.keys.toList();
    if (cities.isEmpty) {
      return _LocationsState(
        icon: Icons.location_off_outlined,
        title: 'locations_empty'.tr,
        actionLabel: 'retry_btn'.tr,
        onAction: _loadLocations,
      );
    }
    return ListView.separated(
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
      itemCount: cities.length,
      separatorBuilder: (context, index) =>
          Divider(height: 1, color: colors.cardBorder),
      itemBuilder: (context, index) {
        final city = cities[index];
        return ListTile(
          contentPadding: EdgeInsets.zero,
          title: Text(
            city,
            style: TextStyle(
              fontSize: BulkaTypeScale.titleSmall,
              color: scheme.onSurface,
            ),
          ),
          trailing: const Icon(Icons.chevron_right_rounded, color: _almond),
          onTap: () => _onCityTapped(city),
        );
      },
    );
  }

  Widget _buildLocationsList(List<BakeryLocation> locations) {
    final colors = context.bulkaColors;
    final scheme = Theme.of(context).colorScheme;
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 8),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              TextButton.icon(
                onPressed: () => setState(() => _showCities = true),
                icon: const Icon(
                  Icons.chevron_left_rounded,
                  color: _almond,
                  size: 20,
                ),
                label: Text(
                  'all_locations'.tr,
                  style: TextStyle(
                    fontSize: BulkaTypeScale.body,
                    color: scheme.onSurface,
                  ),
                ),
              ),
              IconButton(
                onPressed: _loadLocations,
                tooltip: 'refresh_btn'.tr,
                icon: const Icon(
                  Icons.refresh_rounded,
                  color: Color(0xFFD3AD72),
                ),
              ),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(24, 16, 24, 16),
          child: TextField(
            onChanged: (val) => setState(() => _searchQuery = val),
            textInputAction: TextInputAction.search,
            decoration: InputDecoration(
              hintText: 'search_hint'.tr,
              hintStyle: TextStyle(
                color: colors.mutedText,
                fontSize: BulkaTypeScale.body,
              ),
              suffixIcon: const Icon(Icons.search, color: Color(0xFFD3AD72)),
              contentPadding: const EdgeInsets.symmetric(
                horizontal: 20,
                vertical: 16,
              ),
            ),
          ),
        ),
        Expanded(
          child: locations.isEmpty
              ? _LocationsState(
                  icon: Icons.search_off_rounded,
                  title: _searchQuery.isEmpty
                      ? 'locations_empty'.tr
                      : 'locations_search_empty'.tr,
                  actionLabel: 'refresh_btn'.tr,
                  onAction: _searchQuery.isEmpty
                      ? _loadLocations
                      : () => setState(() => _searchQuery = ''),
                )
              : ListView.separated(
                  padding: const EdgeInsets.symmetric(horizontal: 24),
                  itemCount: locations.length,
                  separatorBuilder: (context, index) =>
                      Divider(height: 1, color: colors.cardBorder),
                  itemBuilder: (context, index) {
                    final location = locations[index];
                    return ListTile(
                      contentPadding: EdgeInsets.zero,
                      minVerticalPadding: 12,
                      title: Text(
                        location.name,
                        style: TextStyle(
                          fontSize: BulkaTypeScale.titleSmall,
                          color: scheme.onSurface,
                        ),
                      ),
                      subtitle: location.address.trim().isEmpty
                          ? null
                          : Padding(
                              padding: const EdgeInsets.only(top: 4),
                              child: Text(
                                location.address,
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  color: colors.mutedText,
                                  fontSize: BulkaTypeScale.bodySmall,
                                ),
                              ),
                            ),
                      trailing: const Icon(
                        Icons.chevron_right_rounded,
                        color: _almond,
                      ),
                      onTap: () => unawaited(_onLocationTapped(location)),
                    );
                  },
                ),
        ),
      ],
    );
  }
}

class _LocationsState extends StatelessWidget {
  const _LocationsState({
    required this.icon,
    required this.title,
    required this.actionLabel,
    required this.onAction,
  });

  final IconData icon;
  final String title;
  final String actionLabel;
  final VoidCallback onAction;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 44, color: _caramel),
            const SizedBox(height: 14),
            Text(
              title,
              textAlign: TextAlign.center,
              style: TextStyle(
                color: Theme.of(context).colorScheme.onSurface,
                fontFamily: _headingFont,
                fontSize: BulkaTypeScale.title,
              ),
            ),
            const SizedBox(height: 18),
            OutlinedButton(onPressed: onAction, child: Text(actionLabel)),
          ],
        ),
      ),
    );
  }
}
