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
  bool _pointSelected = false;
  bool _locationsLoaded = false;
  bool _locationsFailed = false;
  double? _locationAccuracyMeters;

  @override
  void initState() {
    super.initState();
    _api = widget.api ?? BulkaApiClient();
    _address = 'map_select_point'.tr;
    unawaited(_loadLocations());
  }

  Future<void> _loadLocations() async {
    try {
      final locations = await _api.getFulfillmentLocations();
      if (mounted) {
        setState(() {
          _locations = locations;
          _locationsLoaded = true;
          _locationsFailed = false;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _locationsLoaded = true;
          _locationsFailed = true;
        });
      }
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
        _pointSelected = true;
        _locationAccuracyMeters = null;
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
        _showLocationError('geo_disabled'.tr);
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

      final locationSettings = kIsWeb
          ? WebSettings(
              accuracy: LocationAccuracy.bestForNavigation,
              maximumAge: Duration.zero,
              timeLimit: const Duration(seconds: 15),
            )
          : const LocationSettings(
              accuracy: LocationAccuracy.bestForNavigation,
              timeLimit: Duration(seconds: 15),
            );
      final position = await Geolocator.getCurrentPosition(
        locationSettings: locationSettings,
      ).timeout(const Duration(seconds: 16));
      if (!mounted) return;
      _applyPosition(position);
    } on TimeoutException {
      _showLocationError('geo_timeout'.tr);
    } catch (_) {
      _showLocationError('geo_failed'.tr);
    } finally {
      if (mounted) setState(() => _locating = false);
    }
  }

  void _applyPosition(Position position) {
    final point = LatLng(position.latitude, position.longitude);
    _locationAccuracyMeters = position.accuracy;
    _moveMap(point, 16);
    _setPoint(point, preserveAccuracy: true);
    if (position.accuracy > 250) {
      _showLocationError(
        'geo_low_accuracy'.trArgs({'meters': position.accuracy.round()}),
      );
    }
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

  void _setPoint(LatLng point, {bool preserveAccuracy = false}) {
    setState(() {
      _point = point;
      _address = 'map_resolving'.tr;
      _addressResolved = false;
      _pointSelected = true;
      if (!preserveAccuracy) _locationAccuracyMeters = null;
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

  ({BakeryLocation branch, DeliveryZone zone, double distanceKm})?
  get _deliveryMatch {
    if (!_pointSelected || !_locationsLoaded || _locationsFailed) return null;
    final matches =
        <({BakeryLocation branch, DeliveryZone zone, double distanceKm})>[];
    for (final location in _locations) {
      final latitude = location.latitude;
      final longitude = location.longitude;
      if (!location.active ||
          !location.deliveryEnabled ||
          latitude == null ||
          longitude == null) {
        continue;
      }
      final distance = distanceBetweenCoordinatesKm(
        firstLatitude: latitude,
        firstLongitude: longitude,
        secondLatitude: _point.latitude,
        secondLongitude: _point.longitude,
      );
      final zone = location.deliveryZoneForDistance(distance);
      if (zone != null) {
        matches.add((branch: location, zone: zone, distanceKm: distance));
      }
    }
    matches.sort(
      (first, second) => first.distanceKm.compareTo(second.distanceKm),
    );
    return matches.isEmpty ? null : matches.first;
  }

  bool get _canConfirm =>
      _pointSelected &&
      _addressResolved &&
      !_resolving &&
      _locationsLoaded &&
      !_locationsFailed &&
      _deliveryMatch != null;

  Widget _deliveryStatus() {
    if (!_pointSelected) {
      return _DeliveryStatusCard(
        icon: Icons.touch_app_rounded,
        title: 'map_delivery_select_point'.tr,
        color: _cocoa,
      );
    }
    if (!_locationsLoaded) {
      return _DeliveryStatusCard(
        icon: Icons.sync_rounded,
        title: 'map_delivery_checking'.tr,
        color: _caramel,
        loading: true,
      );
    }
    if (_locationsFailed) {
      return _DeliveryStatusCard(
        icon: Icons.cloud_off_rounded,
        title: 'map_delivery_check_failed'.tr,
        color: _errorRed,
        actionLabel: 'retry_btn'.tr,
        onAction: _loadLocations,
      );
    }
    final match = _deliveryMatch;
    if (match == null) {
      return _DeliveryStatusCard(
        icon: Icons.location_off_rounded,
        title: 'map_delivery_outside_zone'.tr,
        subtitle: 'map_delivery_outside_hint'.tr,
        color: _errorRed,
      );
    }
    return _DeliveryStatusCard(
      icon: Icons.check_circle_rounded,
      title: 'map_delivery_available'.trArgs({'branch': match.branch.name}),
      subtitle: 'map_delivery_tariff'.trArgs({
        'fee': formatGroupedNumber(match.zone.fee.toDouble()),
        'distance': match.distanceKm.toStringAsFixed(1),
      }),
      color: const Color(0xFF2E7D32),
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
                    selectedPoint: _pointSelected ? _point : null,
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
                  if (_locationAccuracyMeters != null &&
                      _locationAccuracyMeters! <= 250) ...[
                    const SizedBox(height: 8),
                    Text(
                      'geo_accuracy'.trArgs({
                        'meters': _locationAccuracyMeters!.round(),
                      }),
                      style: TextStyle(
                        color: _textDark.withValues(alpha: 0.55),
                        fontSize: 13,
                      ),
                    ),
                  ],
                  const SizedBox(height: 14),
                  _deliveryStatus(),
                  const SizedBox(height: 18),
                  const Divider(height: 1),
                  const SizedBox(height: 18),
                  SizedBox(
                    width: double.infinity,
                    height: 58,
                    child: GradientButton(
                      onPressed: _canConfirm
                          ? () => Navigator.of(context).pop(_selectedLocation())
                          : null,
                      child: Text(
                        _pointSelected &&
                                _locationsLoaded &&
                                !_locationsFailed &&
                                _deliveryMatch == null
                            ? 'map_delivery_unavailable_short'.tr
                            : 'confirm_btn'.tr,
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

class _DeliveryStatusCard extends StatelessWidget {
  const _DeliveryStatusCard({
    required this.icon,
    required this.title,
    required this.color,
    this.subtitle,
    this.loading = false,
    this.actionLabel,
    this.onAction,
  });

  final IconData icon;
  final String title;
  final String? subtitle;
  final Color color;
  final bool loading;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      liveRegion: true,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.08),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: color.withValues(alpha: 0.24)),
        ),
        child: Row(
          children: [
            if (loading)
              SizedBox(
                width: 24,
                height: 24,
                child: CircularProgressIndicator(
                  strokeWidth: 2.2,
                  color: color,
                ),
              )
            else
              Icon(icon, color: color, size: 24),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: TextStyle(
                      color: color,
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  if (subtitle != null) ...[
                    const SizedBox(height: 2),
                    Text(
                      subtitle!,
                      style: TextStyle(
                        color: _textDark.withValues(alpha: 0.68),
                        fontSize: 13,
                        height: 1.25,
                      ),
                    ),
                  ],
                ],
              ),
            ),
            if (onAction != null && actionLabel != null)
              TextButton(onPressed: onAction, child: Text(actionLabel!)),
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
