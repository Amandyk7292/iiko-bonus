part of '../main.dart';

class AddressMapScreen extends StatefulWidget {
  const AddressMapScreen({
    this.api,
    this.initialCity,
    this.initialLatitude,
    this.initialLongitude,
    super.key,
  });

  final BulkaApiClient? api;
  final String? initialCity;
  final double? initialLatitude;
  final double? initialLongitude;

  @override
  State<AddressMapScreen> createState() => _AddressMapScreenState();
}

class _AddressMapScreenState extends State<AddressMapScreen> {
  static const _defaultPoint = LatLng(51.1282, 71.4304);

  late final BulkaApiClient _api;
  final _formKey = GlobalKey<FormState>();
  final _mapController = YandexMapController();
  final _titleController = TextEditingController();
  final _houseController = TextEditingController();
  final _entranceController = TextEditingController();
  final _floorController = TextEditingController();
  final _apartmentController = TextEditingController();
  final _commentController = TextEditingController();
  late LatLng _point;
  double _zoom = 14.5;
  List<BakeryLocation> _locations = const [];
  String _address = '';
  late String _city;
  late bool _hasPreferredCenter;
  bool _addressResolved = false;
  bool _resolving = false;
  bool _locating = false;
  bool _pointSelected = false;
  bool _locationsLoaded = false;
  bool _locationsFailed = false;
  Timer? _locateOnOpenTimer;

  @override
  void initState() {
    super.initState();
    _api = widget.api ?? BulkaApiClient();
    final latitude = widget.initialLatitude;
    final longitude = widget.initialLongitude;
    _hasPreferredCenter =
        latitude != null &&
        longitude != null &&
        latitude.isFinite &&
        longitude.isFinite &&
        latitude >= -90 &&
        latitude <= 90 &&
        longitude >= -180 &&
        longitude <= 180;
    _point = _hasPreferredCenter
        ? LatLng(latitude!, longitude!)
        : _defaultPoint;
    final initialCity = widget.initialCity?.trim() ?? '';
    _city = initialCity.isEmpty ? 'Астана' : initialCity;
    _titleController.text = 'house_label'.tr;
    _address = 'map_select_point'.tr;
    unawaited(_loadLocations());
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _scheduleLocateOnOpen();
    });
  }

  void _scheduleLocateOnOpen() {
    // Let the route finish its first frame before Safari displays the native
    // permission prompt. If the customer already touched the map, preserve
    // that explicit choice instead of moving the pin underneath them.
    _locateOnOpenTimer?.cancel();
    if (_hasPreferredCenter) return;
    _locateOnOpenTimer = Timer(const Duration(milliseconds: 250), () {
      if (!mounted || _pointSelected) return;
      unawaited(_goToMyLocation());
    });
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
    _locateOnOpenTimer?.cancel();
    _mapController.dispose();
    _titleController.dispose();
    _houseController.dispose();
    _entranceController.dispose();
    _floorController.dispose();
    _apartmentController.dispose();
    _commentController.dispose();
    super.dispose();
  }

  Future<void> _goToMyLocation() async {
    if (_locating) return;
    setState(() => _locating = true);
    try {
      if (!kIsWeb) {
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
    } on PermissionDeniedException {
      _showLocationError('geo_permission'.tr);
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
    _moveMap(point, 16);
    _setPoint(point);
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

  void _setPoint(LatLng point) {
    setState(() {
      _point = point;
      _address = 'map_resolving'.tr;
      _addressResolved = false;
      _pointSelected = true;
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

  String? _requiredField(String? value) {
    if ((value ?? '').trim().isEmpty) return 'required_field'.tr;
    return null;
  }

  String? _emptyToNull(String value) {
    final trimmed = value.trim();
    return trimmed.isEmpty ? null : trimmed;
  }

  void _saveAddress() {
    if (!_canConfirm) {
      final message = !_pointSelected || !_addressResolved
          ? 'map_select_point'.tr
          : _resolving || !_locationsLoaded
          ? 'map_delivery_checking'.tr
          : _locationsFailed
          ? 'map_delivery_check_failed'.tr
          : 'map_delivery_outside_zone'.tr;
      _showLocationError(message);
      return;
    }
    if (!_formKey.currentState!.validate()) return;
    Navigator.of(context).pop(
      DeliveryAddress(
        id: DateTime.now().microsecondsSinceEpoch.toString(),
        title: _titleController.text.trim(),
        location: _selectedLocation(),
        house: _houseController.text.trim(),
        entrance: _emptyToNull(_entranceController.text),
        floor: _emptyToNull(_floorController.text),
        apartment: _emptyToNull(_apartmentController.text),
        courierComment: _emptyToNull(_commentController.text),
      ),
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

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      appBar: AppBar(
        toolbarHeight: BulkaLayout.appBarHeight(context),
        centerTitle: true,
        titleSpacing: 0,
        backgroundColor: scheme.surface,
        leading: IconButton(
          onPressed: () => Navigator.of(context).pop(),
          icon: const Icon(Icons.chevron_left_rounded, size: 34),
          color: colors.mutedText,
          tooltip: 'back_tooltip'.tr,
        ),
        title: _BulkaPageTitle('delivery_address_title'.tr),
        actions: const [SizedBox(width: BulkaLayout.appBarSideSlot)],
      ),
      body: SafeArea(
        top: false,
        child: LayoutBuilder(
          builder: (context, constraints) {
            final keyboardInset = MediaQuery.viewInsetsOf(context).bottom;
            final textScale = MediaQuery.textScalerOf(context).scale(1);
            final keyboardVisible = keyboardInset > 0;
            final compact =
                constraints.maxHeight < 700 ||
                keyboardVisible ||
                textScale > 1.15;
            final mapHeight = keyboardVisible
                ? min(118.0, max(88.0, constraints.maxHeight * 0.2))
                : min(
                    textScale > 1.15 ? 270.0 : 360.0,
                    max(210.0, constraints.maxHeight * 0.42),
                  );
            const sheetOverlap = 20.0;
            return Stack(
              children: [
                Positioned(
                  left: 0,
                  top: 0,
                  right: 0,
                  height: mapHeight,
                  child: Stack(
                    children: [
                      YandexMapView(
                        controller: _mapController,
                        center: _point,
                        selectedPoint: _pointSelected ? _point : null,
                        zoom: _zoom,
                        branches: _mapBranches,
                        semanticLabel: 'map_delivery_zones_title'.tr,
                        unavailableLabel: 'map_unavailable'.tr,
                        onCameraChanged: (_, zoom) => _zoom = zoom,
                        onTap: _setPoint,
                      ),
                      if (!kIsWeb)
                        Positioned(
                          right: 18,
                          bottom: sheetOverlap + 14,
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              _MapRoundButton(
                                icon: Icons.add_rounded,
                                tooltip: 'map_zoom_in'.tr,
                                onTap: () => _zoomBy(1),
                              ),
                              const SizedBox(height: 8),
                              _MapRoundButton(
                                icon: Icons.remove_rounded,
                                tooltip: 'map_zoom_out'.tr,
                                onTap: () => _zoomBy(-1),
                              ),
                              const SizedBox(height: 10),
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
                Positioned(
                  left: 0,
                  top: mapHeight - sheetOverlap,
                  right: 0,
                  bottom: 0,
                  child: Container(
                    width: double.infinity,
                    decoration: BoxDecoration(
                      color: scheme.surface,
                      borderRadius: const BorderRadius.vertical(
                        top: Radius.circular(BulkaRadii.card),
                      ),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withValues(alpha: 0.1),
                          blurRadius: 24,
                          offset: const Offset(0, -8),
                        ),
                      ],
                    ),
                    child: Form(
                      key: _formKey,
                      child: SingleChildScrollView(
                        key: const ValueKey('delivery-address-form'),
                        keyboardDismissBehavior:
                            ScrollViewKeyboardDismissBehavior.onDrag,
                        padding: EdgeInsets.fromLTRB(
                          16,
                          compact ? 12 : 16,
                          16,
                          12 +
                              BulkaLayout.safeBottomInset(context) +
                              (keyboardVisible ? 12 : 0),
                        ),
                        child: Column(
                          children: [
                            _BulkaTextField(
                              label: 'address_title_label'.tr,
                              controller: _titleController,
                              validator: _requiredField,
                            ),
                            SizedBox(height: compact ? 8 : 10),
                            LayoutBuilder(
                              builder: (context, fieldConstraints) {
                                final twoColumns =
                                    MediaQuery.textScalerOf(context).scale(1) >
                                    1.15;
                                final width = twoColumns
                                    ? (fieldConstraints.maxWidth - 8) / 2
                                    : (fieldConstraints.maxWidth - 24) / 4;
                                return Wrap(
                                  spacing: 8,
                                  runSpacing: 8,
                                  children: [
                                    SizedBox(
                                      width: width,
                                      child: _BulkaTextField(
                                        label: 'house_label'.tr,
                                        controller: _houseController,
                                        validator: _requiredField,
                                        compact: true,
                                        hintText: '—',
                                      ),
                                    ),
                                    SizedBox(
                                      width: width,
                                      child: _BulkaTextField(
                                        label: 'entrance_label'.tr,
                                        controller: _entranceController,
                                        keyboardType: TextInputType.number,
                                        compact: true,
                                        hintText: '—',
                                      ),
                                    ),
                                    SizedBox(
                                      width: width,
                                      child: _BulkaTextField(
                                        label: 'floor_label'.tr,
                                        controller: _floorController,
                                        keyboardType: TextInputType.number,
                                        compact: true,
                                        hintText: '—',
                                      ),
                                    ),
                                    SizedBox(
                                      width: width,
                                      child: _BulkaTextField(
                                        label: 'apartment_label'.tr,
                                        controller: _apartmentController,
                                        compact: true,
                                        hintText: '—',
                                      ),
                                    ),
                                  ],
                                );
                              },
                            ),
                            SizedBox(height: compact ? 8 : 10),
                            _BulkaTextField(
                              label: 'courier_comment_label'.tr,
                              controller: _commentController,
                              minLines: compact ? 1 : 2,
                              maxLines: 2,
                            ),
                            SizedBox(height: compact ? 8 : 12),
                            GradientButton(
                              onPressed: _saveAddress,
                              height: compact ? 48 : 52,
                              child: Text(
                                'save_address_btn'.tr,
                                style: const TextStyle(
                                  fontSize: BulkaTypeScale.body,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            );
          },
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
    final scheme = Theme.of(context).colorScheme;
    final colors = context.bulkaColors;
    return Tooltip(
      message: tooltip,
      child: Material(
        color: filled ? colors.brandGold : scheme.surface,
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
                      color: filled ? _textDark : colors.brandBrown,
                    ),
                  )
                : Icon(
                    icon,
                    color: filled ? _textDark : colors.brandBrown,
                    size: filled ? 30 : 26,
                  ),
          ),
        ),
      ),
    );
  }
}

class _BulkaTextField extends StatelessWidget {
  const _BulkaTextField({
    required this.label,
    required this.controller,
    this.validator,
    this.keyboardType,
    this.minLines = 1,
    this.maxLines = 1,
    this.compact = false,
    this.hintText,
  });

  final String label;
  final TextEditingController controller;
  final FormFieldValidator<String>? validator;
  final TextInputType? keyboardType;
  final int minLines;
  final int maxLines;
  final bool compact;
  final String? hintText;

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    final scheme = Theme.of(context).colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          maxLines: 2,
          softWrap: true,
          overflow: TextOverflow.visible,
          style: TextStyle(
            color: scheme.onSurface,
            fontFamily: _headingFont,
            fontSize: compact ? 12.5 : 16,
            height: 1.2,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 6),
        TextFormField(
          controller: controller,
          validator: validator,
          keyboardType: keyboardType,
          minLines: minLines,
          maxLines: maxLines,
          textInputAction: maxLines > 1
              ? TextInputAction.newline
              : TextInputAction.next,
          scrollPadding: EdgeInsets.only(
            bottom: MediaQuery.viewInsetsOf(context).bottom + 120,
          ),
          style: const TextStyle(
            fontSize: BulkaTypeScale.body,
            fontWeight: FontWeight.w500,
          ),
          decoration: InputDecoration(
            hintText: hintText ?? 'input_hint'.tr,
            hintStyle: TextStyle(
              color: colors.mutedText,
              fontSize: compact ? 13 : 15,
              fontWeight: FontWeight.w500,
            ),
            filled: true,
            fillColor: Colors.white,
            isDense: true,
            contentPadding: EdgeInsets.symmetric(
              horizontal: compact ? 8 : 16,
              vertical: compact ? 12 : (maxLines > 1 ? 13 : 15),
            ),
            errorMaxLines: 3,
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(BulkaRadii.control),
              borderSide: BorderSide.none,
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(BulkaRadii.control),
              borderSide: BorderSide(color: colors.cardBorder),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(BulkaRadii.control),
              borderSide: BorderSide(color: colors.brandGold, width: 1.2),
            ),
            errorBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(BulkaRadii.control),
              borderSide: const BorderSide(color: _errorRed),
            ),
            focusedErrorBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(BulkaRadii.control),
              borderSide: const BorderSide(color: _errorRed, width: 1.2),
            ),
          ),
        ),
      ],
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
