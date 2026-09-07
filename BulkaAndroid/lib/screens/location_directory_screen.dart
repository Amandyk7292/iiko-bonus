part of '../main.dart';

const _directoryWeek = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

Uri bakeryDirectionsUri(BakeryLocation branch) {
  final lat = branch.latitude;
  final lon = branch.longitude;
  if (lat != null &&
      lon != null &&
      lat.isFinite &&
      lon.isFinite &&
      lat.abs() <= 90 &&
      lon.abs() <= 180) {
    return Uri.parse('https://2gis.ru/directions/points/|$lon,$lat');
  }
  if (RegExp(r'^\d+$').hasMatch(branch.twoGisId)) {
    return Uri.https('2gis.ru', '/firm/${branch.twoGisId}');
  }
  return Uri.https(
    '2gis.ru',
    '/search/${branch.city} ${branch.address} ${branch.name}',
  );
}

/// Schedules in the location service use Kazakhstan time (UTC+5).
({String label, bool? open}) bakeryHoursToday(
  BakeryLocation branch,
  DateTime now,
) {
  final local = now.toUtc().add(const Duration(hours: 5));
  final hours = _bakeryDayHours(branch, _directoryWeek[local.weekday - 1]);
  if (hours == null) return (label: 'directory_hours_unknown'.tr, open: null);
  if (hours['closed'] == true) {
    return (label: 'directory_day_off'.tr, open: false);
  }
  final start = _bakeryMinute(hours['open']);
  final end = _bakeryMinute(hours['close']);
  if (start == null || end == null) {
    return (label: 'directory_hours_unknown'.tr, open: null);
  }
  final minute = local.hour * 60 + local.minute;
  return (
    label: '${hours['open']} – ${hours['close']}',
    open: minute >= start && minute < end,
  );
}

Map<String, dynamic>? _bakeryDayHours(BakeryLocation branch, String day) {
  final raw = branch.hours[day] ?? branch.hours['daily'];
  return raw is Map ? Map<String, dynamic>.from(raw) : null;
}

int? _bakeryMinute(Object? value) {
  final match = RegExp(r'^(\d{2}):(\d{2})$').firstMatch('$value');
  if (match == null) return null;
  final hour = int.parse(match[1]!);
  final minute = int.parse(match[2]!);
  return hour > 24 || minute > 59 || (hour == 24 && minute != 0)
      ? null
      : hour * 60 + minute;
}

class LocationDirectoryScreen extends StatefulWidget {
  const LocationDirectoryScreen({required this.api, super.key});
  final BulkaApiClient api;
  @override
  State<LocationDirectoryScreen> createState() =>
      _LocationDirectoryScreenState();
}

class _LocationDirectoryScreenState extends State<LocationDirectoryScreen> {
  final _map = YandexMapController();
  final _search = TextEditingController();
  List<BakeryLocation> _branches = [];
  String _city = '';
  String _filter = 'all';
  bool _loading = true;
  bool _failed = false;
  bool _sheetOpen = false;
  LatLng _center = const LatLng(43.6532, 51.1975);
  double _zoom = 12;
  late final _LiveRefresh _live;
  final _branchUpdates = ValueNotifier<int>(0);
  Timer? _clock;

  @override
  void initState() {
    super.initState();
    _live = _LiveRefresh(
      widget.api,
      {'locations'},
      () => _load(silent: true),
      busy: () => _loading,
    );
    unawaited(_load());
    _clock = Timer.periodic(const Duration(minutes: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _live.dispose();
    _branchUpdates.dispose();
    _clock?.cancel();
    _search.dispose();
    _map.dispose();
    super.dispose();
  }

  List<String> get _cities =>
      _branches.map((b) => b.city).toSet().toList()..sort();
  List<BakeryLocation> get _visible => _branches
      .where(
        (b) =>
            b.city == _city &&
            (_filter == 'all' || b.supports(_filter)) &&
            '${b.name} ${b.address}'.toLowerCase().contains(
              _search.text.trim().toLowerCase(),
            ),
      )
      .toList();

  Future<void> _load({bool silent = false}) async {
    if (!silent) {
      setState(() {
        _loading = true;
        _failed = false;
      });
    }
    try {
      final branches = await widget.api.getFulfillmentLocations();
      final prefs = await SharedPreferences.getInstance();
      if (!mounted) return;
      setState(() {
        _branches = branches.where((b) => b.active).toList();
        final saved = _city.isNotEmpty
            ? _city
            : prefs.getString('directory_city');
        _city = _cities.contains(saved) ? saved! : _cities.firstOrNull ?? '';
        _loading = false;
        if (!silent || saved != _city) _focusCity();
      });
      _branchUpdates.value++;
    } catch (_) {
      if (mounted && !silent) {
        setState(() {
          _loading = false;
          _failed = true;
        });
      }
    }
  }

  void _focusCity() {
    final points = _branches
        .where(
          (b) => b.city == _city && b.latitude != null && b.longitude != null,
        )
        .toList();
    if (points.isEmpty) return;
    _center = LatLng(
      points.map((b) => b.latitude!).reduce((a, b) => a + b) / points.length,
      points.map((b) => b.longitude!).reduce((a, b) => a + b) / points.length,
    );
    _zoom = points.length == 1 ? 15 : 12;
  }

  TextStyle _title(double size) => TextStyle(
    fontFamily: _descriptionFont,
    fontWeight: FontWeight.w600,
    fontSize: size,
    color: _cocoa,
    height: 1.25,
  );
  TextStyle _body(double size, {Color? color}) => TextStyle(
    fontFamily: _descriptionFont,
    fontWeight: FontWeight.w500,
    fontSize: size,
    color: color ?? _cocoa,
    height: 1.35,
  );

  Future<void> _chooseCity() async {
    FocusScope.of(context).unfocus();
    setState(() => _sheetOpen = true);
    final selected = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      backgroundColor: Colors.white,
      builder: (context) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                children: [
                  Expanded(child: Text('directory_city'.tr, style: _title(22))),
                  IconButton(
                    tooltip: 'close_btn'.tr,
                    onPressed: () => Navigator.pop(context),
                    icon: const Icon(Icons.close),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              Flexible(
                child: SingleChildScrollView(
                  child: Material(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(24),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        for (final city in _cities)
                          ListTile(
                            title: Text(city, style: _body(17)),
                            trailing: city == _city
                                ? const Icon(Icons.check, color: _cocoa)
                                : null,
                            onTap: () => Navigator.pop(context, city),
                          ),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
    if (!mounted) return;
    setState(() {
      _sheetOpen = false;
      if (selected != null) {
        _city = selected;
        _search.clear();
        _focusCity();
      }
    });
    if (selected != null) {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('directory_city', selected);
    }
  }

  Future<void> _launch(Uri uri) async {
    try {
      if (await launchUrl(uri, mode: LaunchMode.externalApplication)) return;
    } catch (_) {
      /* Keep the sheet usable when no URL handler is installed. */
    }
    if (mounted) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('contact_open_error'.tr)));
    }
  }

  Future<void> _openBranch(BakeryLocation branch) async {
    if (_sheetOpen) return;
    FocusScope.of(context).unfocus();
    setState(() {
      _sheetOpen = true;
      if (branch.latitude != null && branch.longitude != null) {
        _center = LatLng(branch.latitude!, branch.longitude!);
        _zoom = 15;
      }
    });
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      backgroundColor: Colors.white,
      builder: (context) => ValueListenableBuilder<int>(
        valueListenable: _branchUpdates,
        builder: (context, _, child) {
          final current = _branches.where((b) => b.id == branch.id).firstOrNull;
          if (current == null) {
            return SafeArea(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Text('directory_closed'.tr, style: _title(20)),
              ),
            );
          }
          return _branchSheet(context, current);
        },
      ),
    );
    if (mounted) setState(() => _sheetOpen = false);
  }

  Widget _branchSheet(BuildContext context, BakeryLocation branch) {
    final hours = bakeryHoursToday(branch, DateTime.now());
    final phone = branch.phone.replaceAll(RegExp(r'[^+0-9]'), '');
    return SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const CircleAvatar(
                  radius: 24,
                  backgroundColor: Color(0xFFFFDC68),
                  child: Icon(Icons.bakery_dining_outlined, color: _cocoa),
                ),
                const SizedBox(width: 12),
                Expanded(child: Text(branch.name, style: _title(22))),
                IconButton(
                  tooltip: 'close_btn'.tr,
                  onPressed: () => Navigator.pop(context),
                  icon: const Icon(Icons.close),
                ),
              ],
            ),
            const SizedBox(height: 18),
            Text(
              [
                branch.city,
                branch.address,
              ].where((s) => s.isNotEmpty).join(', '),
              style: _body(16, color: const Color(0xFF82766E)),
            ),
            const SizedBox(height: 20),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                style: FilledButton.styleFrom(
                  backgroundColor: const Color(0xFFFFD758),
                  foregroundColor: _cocoa,
                  padding: const EdgeInsets.symmetric(vertical: 17),
                ),
                onPressed: () => _launch(bakeryDirectionsUri(branch)),
                icon: const Icon(Icons.alt_route_rounded),
                label: Text(
                  (branch.latitude != null && branch.longitude != null
                          ? 'directory_route'
                          : 'directory_open_2gis')
                      .tr,
                  style: _body(16),
                ),
              ),
            ),
            const SizedBox(height: 18),
            Material(
              color: Colors.white,
              borderRadius: BorderRadius.circular(24),
              clipBehavior: Clip.antiAlias,
              child: ExpansionTile(
                shape: const Border(),
                collapsedShape: const Border(),
                tilePadding: const EdgeInsets.symmetric(
                  horizontal: 18,
                  vertical: 6,
                ),
                title: Text('directory_hours'.tr, style: _body(17)),
                subtitle: Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '${'directory_today'.tr}: ${hours.label}',
                        style: _body(15),
                      ),
                      if (hours.open != null)
                        Text(
                          (hours.open! ? 'directory_open' : 'directory_closed')
                              .tr,
                          style: _body(
                            14,
                            color: hours.open!
                                ? const Color(0xFF458363)
                                : const Color(0xFF9C6257),
                          ),
                        ),
                    ],
                  ),
                ),
                children: [
                  for (final day in _directoryWeek)
                    Builder(
                      builder: (_) {
                        final schedule = _bakeryDayHours(branch, day);
                        final label = schedule == null
                            ? 'directory_hours_unknown'.tr
                            : schedule['closed'] == true
                            ? 'directory_day_off'.tr
                            : _bakeryMinute(schedule['open']) == null ||
                                  _bakeryMinute(schedule['close']) == null
                            ? 'directory_hours_unknown'.tr
                            : '${schedule['open']} – ${schedule['close']}';
                        return Padding(
                          padding: const EdgeInsets.fromLTRB(18, 0, 18, 12),
                          child: Row(
                            children: [
                              Expanded(
                                child: Text(
                                  'directory_$day'.tr,
                                  style: _body(14),
                                ),
                              ),
                              Text(label, style: _body(14)),
                            ],
                          ),
                        );
                      },
                    ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                _tag('directory_bakery'.tr),
                if (branch.pickupEnabled) _tag('order_pickup'.tr),
                if (branch.deliveryEnabled) _tag('order_delivery'.tr),
                if (branch.preorderEnabled) _tag('order_preorder'.tr),
              ],
            ),
            if (phone.length >= 7) ...[
              const SizedBox(height: 20),
              SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  onPressed: () => _launch(Uri(scheme: 'tel', path: phone)),
                  icon: const Icon(Icons.phone_outlined),
                  label: Text(branch.phone),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _tag(String label) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(18),
    ),
    child: Text(label, style: _body(12)),
  );

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_failed || _branches.isEmpty) {
      return _LocationsState(
        icon: Icons.location_off_outlined,
        title: (_failed ? 'locations_error' : 'locations_empty').tr,
        actionLabel: 'retry_btn'.tr,
        onAction: _load,
      );
    }
    final branches = _visible;
    return ColoredBox(
      color: Colors.white,
      child: SafeArea(
        bottom: true,
        child: LayoutBuilder(
          builder: (context, constraints) => Column(
            children: [
              SizedBox(
                height: max(100.0, constraints.maxHeight * .32) + 64,
                child: YandexMapView(
                  key: ValueKey('directory-map-${AppLang.current}'),
                  controller: _map,
                  center: _center,
                  selectedPoint: null,
                  zoom: _zoom,
                  directoryMode: true,
                  cityLabel: _city,
                  onCityTap: _chooseCity,
                  language: AppLang.current,
                  interactive: !_sheetOpen,
                  semanticLabel: 'locations_title'.tr,
                  unavailableLabel: 'locations_error'.tr,
                  onCameraChanged: (center, zoom) {
                    _center = center;
                    _zoom = zoom;
                  },
                  onBranchTap: (id) {
                    final branch = branches
                        .where((b) => b.id == id)
                        .firstOrNull;
                    if (branch != null) unawaited(_openBranch(branch));
                  },
                  branches: [
                    for (final branch in branches)
                      if (branch.latitude != null && branch.longitude != null)
                        YandexMapBranch(
                          id: branch.id,
                          name: branch.name,
                          address: branch.address,
                          point: LatLng(branch.latitude!, branch.longitude!),
                          zones: const [],
                        ),
                  ],
                ),
              ),
              Expanded(
                child: Container(
                  decoration: const BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.vertical(
                      top: Radius.circular(28),
                    ),
                  ),
                  child: Column(
                    children: [
                      const SizedBox(height: 10),
                      Container(
                        width: 34,
                        height: 4,
                        decoration: BoxDecoration(
                          color: const Color(0xFFE5DFD4),
                          borderRadius: BorderRadius.circular(4),
                        ),
                      ),
                      Padding(
                        padding: const EdgeInsets.fromLTRB(18, 12, 18, 10),
                        child: TextField(
                          controller: _search,
                          onChanged: (_) => setState(() {}),
                          style: _body(15),
                          decoration: InputDecoration(
                            hintText: 'directory_search'.tr,
                            prefixIcon: const Icon(Icons.search),
                            isDense: true,
                            contentPadding: const EdgeInsets.symmetric(
                              vertical: 12,
                              horizontal: 16,
                            ),
                            suffixIcon: _search.text.isEmpty
                                ? null
                                : IconButton(
                                    tooltip: 'catalog_clear_search'.tr,
                                    onPressed: () => setState(_search.clear),
                                    icon: const Icon(Icons.close),
                                  ),
                          ),
                        ),
                      ),
                      SizedBox(
                        height: 44,
                        child: ListView(
                          scrollDirection: Axis.horizontal,
                          padding: const EdgeInsets.symmetric(horizontal: 18),
                          children: [
                            for (final filter in [
                              'all',
                              'pickup',
                              'delivery',
                              'preorder',
                            ])
                              Padding(
                                padding: const EdgeInsets.only(right: 8),
                                child: ChoiceChip(
                                  label: Text(
                                    (filter == 'all'
                                            ? 'directory_all'
                                            : 'order_$filter')
                                        .tr,
                                    style: _body(12),
                                  ),
                                  selected: _filter == filter,
                                  showCheckmark: false,
                                  selectedColor: const Color(0xFFFFDD70),
                                  backgroundColor: Colors.white,
                                  side: BorderSide.none,
                                  onSelected: (_) =>
                                      setState(() => _filter = filter),
                                ),
                              ),
                          ],
                        ),
                      ),
                      Expanded(
                        child: branches.isEmpty
                            ? Center(
                                child: Text(
                                  'locations_search_empty'.tr,
                                  style: _body(15),
                                ),
                              )
                            : RefreshIndicator(
                                onRefresh: _load,
                                child: ListView.separated(
                                  padding: const EdgeInsets.fromLTRB(
                                    20,
                                    8,
                                    20,
                                    24,
                                  ),
                                  itemCount: branches.length,
                                  separatorBuilder: (_, index) => const Divider(
                                    height: 1,
                                    color: Color(0xFFEEE8DD),
                                  ),
                                  itemBuilder: (context, index) {
                                    final branch = branches[index];
                                    final hours = bakeryHoursToday(
                                      branch,
                                      DateTime.now(),
                                    );
                                    return ListTile(
                                      contentPadding:
                                          const EdgeInsets.symmetric(
                                            vertical: 9,
                                          ),
                                      title: Text(
                                        branch.name,
                                        style: _title(18),
                                      ),
                                      subtitle: Padding(
                                        padding: const EdgeInsets.only(top: 7),
                                        child: Column(
                                          crossAxisAlignment:
                                              CrossAxisAlignment.start,
                                          children: [
                                            Text(
                                              branch.address,
                                              style: _body(
                                                14,
                                                color: const Color(0xFF908780),
                                              ),
                                            ),
                                            const SizedBox(height: 7),
                                            Row(
                                              children: [
                                                const Icon(
                                                  Icons.schedule,
                                                  size: 15,
                                                  color: _caramel,
                                                ),
                                                const SizedBox(width: 5),
                                                Expanded(
                                                  child: Text(
                                                    hours.label,
                                                    style: _body(
                                                      12,
                                                      color: _caramel,
                                                    ),
                                                  ),
                                                ),
                                                if (hours.open != null)
                                                  Text(
                                                    (hours.open!
                                                            ? 'directory_open'
                                                            : 'directory_closed')
                                                        .tr,
                                                    style: _body(
                                                      11,
                                                      color: hours.open!
                                                          ? const Color(
                                                              0xFF458363,
                                                            )
                                                          : const Color(
                                                              0xFF9C6257,
                                                            ),
                                                    ),
                                                  ),
                                              ],
                                            ),
                                          ],
                                        ),
                                      ),
                                      trailing: const Icon(
                                        Icons.chevron_right_rounded,
                                        color: _cocoa,
                                      ),
                                      onTap: () => _openBranch(branch),
                                    );
                                  },
                                ),
                              ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
