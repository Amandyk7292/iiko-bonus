part of '../main.dart';

class AddressMapScreen extends StatefulWidget {
  const AddressMapScreen({super.key});

  @override
  State<AddressMapScreen> createState() => _AddressMapScreenState();
}

class _AddressMapScreenState extends State<AddressMapScreen> {
  static const _defaultPoint = LatLng(43.6532, 51.1975);

  final _mapController = MapController();
  final _searchController = TextEditingController();
  LatLng _point = _defaultPoint;
  double _zoom = 14.5;
  String _address = '';
  bool _addressResolved = false;
  bool _resolving = false;
  bool _locating = false;

  @override
  void initState() {
    super.initState();
    _address = 'map_select_point'.tr;
    unawaited(_reverseGeocode(_point));
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _search(String value) async {
    final query = value.trim();
    if (query.isEmpty) return;
    setState(() => _resolving = true);
    try {
      final uri = Uri.https('nominatim.openstreetmap.org', '/search', {
        'format': 'jsonv2',
        'limit': '1',
        'q': '$query, Aktau, Kazakhstan',
        'accept-language': AppLang.current,
      });
      final response = await http
          .get(uri, headers: _osmHeaders)
          .timeout(const Duration(seconds: 12));
      if (!mounted) return;
      if (response.statusCode != 200) {
        _showLocationError('map_search_failed'.tr);
        return;
      }
      final items = jsonDecode(response.body);
      if (items is! List || items.isEmpty) {
        _showLocationError('map_search_not_found'.tr);
        return;
      }
      final item = _asMap(items.first);
      final lat = _asDouble(item['lat']);
      final lon = _asDouble(item['lon']);
      if (lat == 0 || lon == 0) {
        _showLocationError('map_search_not_found'.tr);
        return;
      }
      final nextPoint = LatLng(lat, lon);
      setState(() {
        _point = nextPoint;
        _address = _cleanAddress(
          _asString(item['display_name'], fallback: query),
        );
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
    setState(() => _zoom = zoom);
    _mapController.move(point, zoom);
  }

  void _zoomBy(double delta) {
    final nextZoom = (_zoom + delta).clamp(11.0, 18.0);
    _moveMap(_point, nextZoom);
  }

  Future<void> _reverseGeocode(LatLng point) async {
    setState(() => _resolving = true);
    try {
      final uri = Uri.https('nominatim.openstreetmap.org', '/reverse', {
        'format': 'jsonv2',
        'lat': point.latitude.toString(),
        'lon': point.longitude.toString(),
        'addressdetails': '1',
        'accept-language': AppLang.current,
      });
      final response = await http
          .get(uri, headers: _osmHeaders)
          .timeout(const Duration(seconds: 12));
      if (response.statusCode != 200) return;
      final json = _asMap(jsonDecode(response.body));
      final nextAddress = _cleanAddress(
        _asString(json['display_name'], fallback: 'map_selected_point'.tr),
      );
      if (!mounted) return;
      setState(() {
        _address = nextAddress;
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
    unawaited(_reverseGeocode(point));
  }

  DeliveryLocation _selectedLocation() {
    return DeliveryLocation(
      city: 'Aktau',
      address: _addressResolved ? _address : 'map_selected_point'.tr,
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
        backgroundColor: Colors.white,
        leading: IconButton(
          onPressed: () => Navigator.of(context).pop(),
          icon: const Icon(Icons.chevron_left_rounded, size: 34),
          color: _cocoa.withValues(alpha: 0.56),
          tooltip: 'back_tooltip'.tr,
        ),
        title: Text(
          'locations_title'.tr,
          style: const TextStyle(
            fontFamily: _headingFont,
            fontSize: 30,
            fontWeight: FontWeight.w400,
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
                  _DeliveryMap(
                    controller: _mapController,
                    point: _point,
                    zoom: _zoom,
                    onPositionChanged: (point, zoom) {
                      _point = point;
                      _zoom = zoom;
                    },
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
                  AnimatedSwitcher(
                    duration: const Duration(milliseconds: 160),
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
                      onPressed: () =>
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

class _DeliveryMap extends StatelessWidget {
  const _DeliveryMap({
    required this.controller,
    required this.point,
    this.zoom = 15,
    this.onPositionChanged,
    this.onTap,
    this.interactive = true,
  });

  final MapController? controller;
  final LatLng point;
  final double zoom;
  final void Function(LatLng point, double zoom)? onPositionChanged;
  final ValueChanged<LatLng>? onTap;
  final bool interactive;

  @override
  Widget build(BuildContext context) {
    return FlutterMap(
      mapController: controller,
      options: MapOptions(
        initialCenter: point,
        initialZoom: zoom,
        minZoom: 11,
        maxZoom: 18,
        interactionOptions: interactive
            ? const InteractionOptions()
            : const InteractionOptions(flags: InteractiveFlag.none),
        onTap: interactive && onTap != null
            ? (_, point) => onTap!(point)
            : null,
        onPositionChanged: onPositionChanged == null
            ? null
            : (camera, _) => onPositionChanged!(camera.center, camera.zoom),
      ),
      children: [
        TileLayer(
          urlTemplate:
              'https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
          fallbackUrl:
              'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
          userAgentPackageName: 'kz.bulka.bonus',
          errorTileCallback: (tile, error, stackTrace) {
            debugPrint('Map tile load failed: $error');
          },
          errorImage: const AssetImage('assets/brand/bulka_logo.png'),
        ),
        DecoratedBox(
          decoration: BoxDecoration(
            color: const Color(0xFFFFFBF3).withValues(alpha: 0.34),
          ),
        ),
        PolygonLayer(
          polygons: [
            Polygon(
              points: _deliveryZone,
              borderColor: const Color(0xFF2F80ED),
              borderStrokeWidth: 2.2,
              color: const Color(0xFF2F80ED).withValues(alpha: 0.08),
            ),
          ],
        ),
        CircleLayer(
          circles: [
            for (final bakery in _bakeryPoints)
              CircleMarker(
                point: bakery.point,
                radius: 34,
                color: const Color(0xFF2F80ED).withValues(alpha: 0.13),
                borderColor: const Color(0xFF2F80ED),
                borderStrokeWidth: 3,
              ),
            CircleMarker(
              point: point,
              radius: 42,
              color: const Color(0xFF7B2FF2).withValues(alpha: 0.1),
              borderColor: const Color(0xFF7B2FF2),
              borderStrokeWidth: 3,
            ),
          ],
        ),
        MarkerLayer(
          markers: [
            for (final bakery in _bakeryPoints)
              Marker(
                point: bakery.point,
                width: 104,
                height: 72,
                child: _MapPointLabel(label: bakery.label),
              ),
            Marker(
              point: point,
              width: 116,
              height: 86,
              child: _MapPointLabel(
                label: 'map_you_are_here'.tr,
                accent: const Color(0xFF7B2FF2),
              ),
            ),
          ],
        ),
        RichAttributionWidget(
          alignment: AttributionAlignment.bottomLeft,
          showFlutterMapAttribution: false,
          permanentHeight: 22,
          popupBackgroundColor: Colors.white.withValues(alpha: 0.94),
          popupBorderRadius: BorderRadius.circular(12),
          openButton: (context, open) => IconButton(
            onPressed: open,
            tooltip: 'map_data_attribution'.tr,
            icon: const Icon(Icons.info_outline_rounded, size: 22),
          ),
          closeButton: (context, close) => IconButton(
            onPressed: close,
            tooltip: 'close_tooltip'.tr,
            icon: const Icon(Icons.cancel_outlined, size: 22),
          ),
          attributions: [
            LogoSourceAttribution(
              Container(
                height: 22,
                padding: const EdgeInsets.symmetric(horizontal: 6),
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.9),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  '${'map_data_attribution'.tr} © OSM · CARTO · Esri',
                  style: const TextStyle(fontSize: 10, color: _textDark),
                ),
              ),
              height: 22,
              tooltip: 'map_data_attribution'.tr,
              onTap: () => unawaited(
                launchUrl(Uri.parse('https://www.openstreetmap.org/copyright')),
              ),
            ),
            TextSourceAttribution(
              'OpenStreetMap contributors',
              onTap: () => unawaited(
                launchUrl(Uri.parse('https://www.openstreetmap.org/copyright')),
              ),
            ),
            TextSourceAttribution(
              'CARTO',
              onTap: () => unawaited(
                launchUrl(Uri.parse('https://carto.com/attributions')),
              ),
            ),
            TextSourceAttribution(
              'Esri',
              onTap: () => unawaited(
                launchUrl(
                  Uri.parse('https://www.esri.com/legal/copyright-trademarks'),
                ),
              ),
            ),
          ],
        ),
      ],
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

class _MapPointLabel extends StatelessWidget {
  const _MapPointLabel({
    required this.label,
    this.accent = const Color(0xFF2F80ED),
  });

  final String label;
  final Color accent;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          constraints: const BoxConstraints(maxWidth: 104),
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
          decoration: BoxDecoration(
            color: Colors.white.withValues(alpha: 0.94),
            borderRadius: BorderRadius.circular(8),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.12),
                blurRadius: 10,
                offset: const Offset(0, 4),
              ),
            ],
            border: Border.all(color: const Color(0xFFE5E0D8)),
          ),
          child: Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: Color(0xFF30343B),
              fontSize: 13,
              fontWeight: FontWeight.w900,
            ),
          ),
        ),
        Transform.translate(
          offset: const Offset(0, -2),
          child: Icon(Icons.arrow_drop_down, color: Colors.white, size: 22),
        ),
        Container(
          width: 18,
          height: 18,
          decoration: BoxDecoration(
            color: accent,
            shape: BoxShape.circle,
            border: Border.all(color: Colors.white, width: 3),
            boxShadow: [
              BoxShadow(
                color: accent.withValues(alpha: 0.28),
                blurRadius: 10,
                offset: const Offset(0, 4),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _MapBakeryPoint {
  const _MapBakeryPoint(this.label, this.point);

  final String label;
  final LatLng point;
}

const _deliveryZone = [
  LatLng(43.620, 51.120),
  LatLng(43.690, 51.118),
  LatLng(43.721, 51.197),
  LatLng(43.686, 51.285),
  LatLng(43.612, 51.279),
  LatLng(43.590, 51.190),
];

const _bakeryPoints = [
  _MapBakeryPoint('Bulka', LatLng(43.6532, 51.1975)),
  _MapBakeryPoint('Premium', LatLng(43.6419, 51.1707)),
  _MapBakeryPoint('Green Plaza', LatLng(43.6752, 51.2226)),
];

const _osmHeaders = {'User-Agent': 'BulkaBonus/1.0 contact@bulka.local'};

String _cleanAddress(String value) {
  final parts = value
      .split(',')
      .map((part) => part.trim())
      .where((part) => part.isNotEmpty)
      .toList();
  if (parts.length <= 3) return value;
  return parts.take(3).join(', ');
}
