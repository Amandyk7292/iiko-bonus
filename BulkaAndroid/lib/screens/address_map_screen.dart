part of '../main.dart';

class AddressMapScreen extends StatefulWidget {
  const AddressMapScreen({this.api, super.key});

  final BulkaApiClient? api;

  @override
  State<AddressMapScreen> createState() => _AddressMapScreenState();
}

class _AddressMapScreenState extends State<AddressMapScreen> {
  static const _defaultPoint = LatLng(43.6532, 51.1975);

  late final BulkaApiClient _api;
  final _mapController = YandexMapController();
  final _searchController = TextEditingController();
  LatLng _point = _defaultPoint;
  double _zoom = 14.5;
  List<BakeryLocation> _locations = const [];
  String _address = '';
  String _city = 'Aktau';
  bool _addressResolved = false;
  bool _resolving = false;
  bool _locating = false;

  @override
  void initState() {
    super.initState();
    _api = widget.api ?? BulkaApiClient();
    _address = 'map_select_point'.tr;
    unawaited(_loadLocations());
    unawaited(_reverseGeocode(_point));
  }

  Future<void> _loadLocations() async {
    try {
      final locations = await _api.getFulfillmentLocations();
      if (mounted) setState(() => _locations = locations);
    } catch (_) {
      // Address selection remains available; the server validates the zone.
    }
  }

  @override
  void dispose() {
    _mapController.dispose();
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _search(String value) async {
    final query = value.trim();
    if (query.isEmpty) return;
    setState(() => _resolving = true);
    try {
      final items = await _api.searchDeliveryAddress(query);
      if (!mounted) return;
      if (items.isEmpty) {
        _showLocationError('map_search_not_found'.tr);
        return;
      }
      final item = _asMap(items.first);
      final lat = _asDouble(item['latitude']);
      final lon = _asDouble(item['longitude']);
      if (lat == 0 || lon == 0) {
        _showLocationError('map_search_not_found'.tr);
        return;
      }
      final nextPoint = LatLng(lat, lon);
      setState(() {
        _address = _cleanAddress(
          _asString(item['address'] ?? item['displayName'], fallback: query),
        );
        _city = _asString(item['city'], fallback: _city);
        _addressResolved = true;
      });
      _moveMap(nextPoint, 16);
    } catch (_) {
      if (mounted) _showLocationError('map_search_failed'.tr);
    } finally {
      if (mounted) setState(() => _resolving = false);
    }
  }

  Future<void> _goToMyLocation() async {
    if (_locating) return;
    setState(() => _locating = true);
    try {
      final serviceEnabled = await Geolocator.isLocationServiceEnabled()
          .timeout(const Duration(seconds: 3), onTimeout: () => false);
      if (!serviceEnabled) {
        _useAktauFallback('geo_disabled'.tr);
        return;
      }

      var permission = await Geolocator.checkPermission().timeout(
        const Duration(seconds: 3),
        onTimeout: () => LocationPermission.denied,
      );
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission().timeout(
          const Duration(seconds: 8),
          onTimeout: () => LocationPermission.denied,
        );
      }
      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        _showLocationError('geo_permission'.tr);
        return;
      }

      final lastKnown = await Geolocator.getLastKnownPosition().timeout(
        const Duration(seconds: 2),
        onTimeout: () => null,
      );
      if (lastKnown != null) {
        if (!mounted) return;
        _applyPosition(lastKnown);
        return;
      }

      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.medium,
          timeLimit: Duration(seconds: 4),
        ),
      ).timeout(const Duration(seconds: 5));
      if (!mounted) return;
      _applyPosition(position);
    } on TimeoutException {
      _useAktauFallback('geo_timeout'.tr);
    } catch (_) {
      _useAktauFallback('geo_failed'.tr);
    } finally {
      if (mounted) setState(() => _locating = false);
    }
  }

  void _applyPosition(Position position) {
    final point = LatLng(position.latitude, position.longitude);
    _moveMap(point, 16);
    _setPoint(point);
  }

  void _useAktauFallback(String message) {
    if (!mounted) return;
    _moveMap(_defaultPoint, 14.5);
    _setPoint(_defaultPoint);
    _showLocationError(message);
  }

  void _showLocationError(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
  }

  void _moveMap(LatLng point, double zoom) {
    if (!mounted) return;
    setState(() {
      _point = point;
      _zoom = zoom;
    });
    _mapController.move(point, zoom, selected: point);
  }

  void _zoomBy(double delta) {
    final nextZoom = (_zoom + delta).clamp(11.0, 18.0);
    setState(() => _zoom = nextZoom);
    _mapController.zoomBy(delta);
  }

  Future<void> _reverseGeocode(LatLng point) async {
    setState(() => _resolving = true);
    try {
      final result = await _api.reverseDeliveryAddress(
        latitude: point.latitude,
        longitude: point.longitude,
      );
      final nextAddress = _cleanAddress(
        _asString(
          result['address'] ?? result['displayName'],
          fallback: 'map_selected_point'.tr,
        ),
      );
      if (!mounted) return;
      setState(() {
        _address = nextAddress;
        _city = _asString(result['city'], fallback: _city);
        _addressResolved = true;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _address = 'map_selected_point'.tr;
        _addressResolved = false;
      });
    } finally {
      if (mounted) setState(() => _resolving = false);
    }
  }

  void _setPoint(LatLng point) {
    setState(() {
      _point = point;
      _address = 'map_resolving'.tr;
      _addressResolved = false;
    });
    _mapController.move(point, _zoom, selected: point);
    unawaited(_reverseGeocode(point));
  }

  List<YandexMapBranch> get _mapBranches => _locations
      .where(
        (location) =>
            location.latitude != null &&
            location.longitude != null &&
            location.active,
      )
      .map(
        (location) => YandexMapBranch(
          id: location.id,
          name: location.name,
          address: location.address,
          point: LatLng(location.latitude!, location.longitude!),
          active: location.active,
          deliveryEnabled: location.deliveryEnabled,
          zones: location.deliveryZones
              .map(
                (zone) => YandexDeliveryZone(
                  id: zone.id,
                  radiusKm: zone.radiusKm,
                  fee: zone.fee,
                  minOrder: zone.minOrder,
                  color: zone.color,
                ),
              )
              .toList(),
        ),
      )
      .toList();

  DeliveryLocation _selectedLocation() {
    return DeliveryLocation(
      city: _city,
      address: _address,
      latitude: _point.latitude,
      longitude: _point.longitude,
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        centerTitle: true,
        titleSpacing: 0,
        backgroundColor: Colors.white,
        leading: IconButton(
          onPressed: () => Navigator.of(context).pop(),
          icon: const Icon(Icons.chevron_left_rounded, size: 34),
          color: _cocoa.withValues(alpha: 0.56),
          tooltip: 'back_tooltip'.tr,
        ),
        title: Text(
          'locations_title'.tr,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(
            fontFamily: _brandFont,
            fontSize: 22,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
      body: SafeArea(
        top: false,
        child: Column(
          children: [
            Expanded(
              child: Stack(
                children: [
                  YandexMapView(
                    controller: _mapController,
                    center: _point,
                    selectedPoint: _point,
                    zoom: _zoom,
                    branches: _mapBranches,
                    onCameraChanged: (_, zoom) => _zoom = zoom,
                    onTap: _setPoint,
                  ),
                  Positioned(
                    left: 16,
                    top: 14,
                    right: 16,
                    child: _MapSearchField(
                      controller: _searchController,
                      onSubmitted: _search,
                    ),
                  ),
                  Positioned(
                    right: 24,
                    bottom: 22,
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        _MapRoundButton(
                          icon: Icons.add_rounded,
                          tooltip: 'map_zoom_in'.tr,
                          onTap: () => _zoomBy(1),
                        ),
                        const SizedBox(height: 10),
                        _MapRoundButton(
                          icon: Icons.remove_rounded,
                          tooltip: 'map_zoom_out'.tr,
                          onTap: () => _zoomBy(-1),
                        ),
                        const SizedBox(height: 14),
                        _MapRoundButton(
                          icon: Icons.near_me_rounded,
                          tooltip: 'map_my_location'.tr,
                          filled: true,
                          loading: _locating,
                          onTap: _goToMyLocation,
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.fromLTRB(24, 20, 24, 26),
              color: Colors.white,
              child: Column(
                children: [
                  BulkaMotionSwitcher(
                    duration: BulkaMotion.fast,
                    offset: const Offset(0, 0.12),
                    scale: 0.98,
                    child: _resolving
                        ? const SizedBox(
                            key: ValueKey('loading-address'),
                            height: 32,
                            width: 32,
                            child: CircularProgressIndicator(strokeWidth: 2.4),
                          )
                        : Text(
                            _address,
                            key: ValueKey(_address),
                            textAlign: TextAlign.center,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: Colors.black,
                              fontFamily: _headingFont,
                              fontSize: 24,
                              height: 1.08,
                              fontWeight: FontWeight.w400,
                            ),
                          ),
                  ),
                  const SizedBox(height: 24),
                  const Divider(height: 1),
                  const SizedBox(height: 22),
                  SizedBox(
                    width: double.infinity,
                    height: 58,
                    child: GradientButton(
                      onPressed: !_addressResolved || _resolving
                          ? null
                          : () =>
                                Navigator.of(context).pop(_selectedLocation()),
                      child: Text(
                        'confirm_btn'.tr,
                        style: const TextStyle(
                          fontSize: 20,
                          fontWeight: FontWeight.w400,
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

class _MapSearchField extends StatelessWidget {
  const _MapSearchField({required this.controller, required this.onSubmitted});

  final TextEditingController controller;
  final ValueChanged<String> onSubmitted;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      elevation: 10,
      shadowColor: Colors.black.withValues(alpha: 0.12),
      borderRadius: BorderRadius.circular(18),
      child: TextField(
        controller: controller,
        textInputAction: TextInputAction.search,
        onSubmitted: onSubmitted,
        style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w400),
        decoration: InputDecoration(
          hintText: 'search_hint'.tr,
          hintStyle: TextStyle(
            color: _textDark.withValues(alpha: 0.42),
            fontSize: 20,
            fontWeight: FontWeight.w300,
          ),
          prefixIcon: Icon(
            Icons.search_rounded,
            color: _cocoa.withValues(alpha: 0.36),
            size: 30,
          ),
          border: InputBorder.none,
          contentPadding: const EdgeInsets.symmetric(
            horizontal: 18,
            vertical: 20,
          ),
        ),
      ),
    );
  }
}

class _MapRoundButton extends StatelessWidget {
  const _MapRoundButton({
    required this.icon,
    required this.tooltip,
    required this.onTap,
    this.filled = false,
    this.loading = false,
  });

  final IconData icon;
  final String tooltip;
  final VoidCallback onTap;
  final bool filled;
  final bool loading;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: Material(
        color: filled ? _cocoa : Colors.white,
        shape: const CircleBorder(),
        elevation: 8,
        shadowColor: Colors.black.withValues(alpha: 0.16),
        child: InkWell(
          onTap: loading
              ? null
              : () {
                  BulkaMotion.selection();
                  onTap();
                },
          customBorder: const CircleBorder(),
          child: SizedBox(
            width: filled ? 56 : 48,
            height: filled ? 56 : 48,
            child: loading
                ? Padding(
                    padding: const EdgeInsets.all(16),
                    child: CircularProgressIndicator(
                      strokeWidth: 2.4,
                      color: filled ? Colors.white : _cocoa,
                    ),
                  )
                : Icon(
                    icon,
                    color: filled ? Colors.white : _cocoa,
                    size: filled ? 30 : 26,
                  ),
          ),
        ),
      ),
    );
  }
}

String _cleanAddress(String value) {
  final parts = value
      .split(',')
      .map((part) => part.trim())
      .where((part) => part.isNotEmpty)
      .toList();
  if (parts.length <= 3) return value;
  return parts.take(3).join(', ');
}
