part of '../main.dart';

class LocationsScreen extends StatefulWidget {
  const LocationsScreen({super.key});

  @override
  State<LocationsScreen> createState() => _LocationsScreenState();
}

class _LocationsScreenState extends State<LocationsScreen> {
  bool _showCities = false;
  String _selectedCity = 'Шымкент';
  String _searchQuery = '';
  bool _loading = true;

  Map<String, List<String>> _cityLocations = {};

  @override
  void initState() {
    super.initState();
    _loadLocations();
  }

  Future<void> _loadLocations() async {
    try {
      final api = BulkaApiClient();
      final locs = await api.getLocations();
      setState(() {
        if (locs.isNotEmpty) {
          _cityLocations = locs;
        } else {
          // Fallback if empty
          _cityLocations = {
            'Шымкент': [],
            'Алматы': [],
          };
        }
        if (!_cityLocations.containsKey(_selectedCity)) {
          _selectedCity = _cityLocations.keys.first;
        }
        _loading = false;
      });
    } catch (e) {
      setState(() {
        _loading = false;
        _cityLocations = {
          'Шымкент': [],
          'Алматы': [],
        };
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

  void _onLocationTapped(String location) {
    // Returning the selected location and city to the previous screen if needed.
    Navigator.of(context).pop(location);
  }

  @override
  Widget build(BuildContext context) {
    final locations = _cityLocations[_selectedCity] ?? [];
    final filteredLocations = locations
        .where((loc) => loc.toLowerCase().contains(_searchQuery.toLowerCase()))
        .toList();

    return Scaffold(
      backgroundColor: const Color(0xFFFAF9F7),
      appBar: AppBar(
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
          color: _cocoa.withValues(alpha: 0.56),
          tooltip: 'Назад',
        ),
        title: const Text(
          'Локации',
          style: TextStyle(
            color: Colors.black,
            fontSize: 20,
            fontWeight: FontWeight.w700,
          ),
        ),
        elevation: 0,
        backgroundColor: Colors.transparent,
      ),
      body: SafeArea(
        child: _loading 
            ? const Center(child: CircularProgressIndicator(color: Colors.orange))
            : (_showCities ? _buildCitiesList() : _buildLocationsList(filteredLocations)),
      ),
    );
  }

  Widget _buildCitiesList() {
    final cities = _cityLocations.keys.toList();
    return ListView.separated(
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
      itemCount: cities.length,
      separatorBuilder: (_, __) => Divider(height: 1, color: _textDark.withValues(alpha: 0.08)),
      itemBuilder: (context, index) {
        final city = cities[index];
        return ListTile(
          contentPadding: EdgeInsets.zero,
          title: Text(
            city,
            style: const TextStyle(
              fontSize: 18,
              color: _textDark,
            ),
          ),
          trailing: const Icon(Icons.chevron_right_rounded, color: _almond),
          onTap: () => _onCityTapped(city),
        );
      },
    );
  }

  Widget _buildLocationsList(List<String> locations) {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 8),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              GestureDetector(
                onTap: () => setState(() => _showCities = true),
                child: Row(
                  children: [
                    const Icon(Icons.chevron_left_rounded, color: _almond, size: 20),
                    const SizedBox(width: 4),
                    const Text(
                      'Все Локации',
                      style: TextStyle(
                        fontSize: 16,
                        color: _textDark,
                      ),
                    ),
                  ],
                ),
              ),
              GestureDetector(
                onTap: () {
                  Navigator.of(context).push(MaterialPageRoute(
                    builder: (_) => const AddressMapScreen(),
                  ));
                },
                child: const Text(
                  'Посмотреть на карте',
                  style: TextStyle(
                    fontSize: 16,
                    color: Color(0xFFD3AD72),
                  ),
                ),
              ),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(24, 16, 24, 16),
          child: Container(
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(16),
            ),
            child: TextField(
              onChanged: (val) => setState(() => _searchQuery = val),
              decoration: const InputDecoration(
                hintText: 'Поиск',
                hintStyle: TextStyle(color: Colors.black38, fontSize: 16),
                suffixIcon: Icon(Icons.search, color: Color(0xFFD3AD72)),
                border: InputBorder.none,
                contentPadding: EdgeInsets.symmetric(horizontal: 20, vertical: 16),
              ),
            ),
          ),
        ),
        Expanded(
          child: ListView.separated(
            padding: const EdgeInsets.symmetric(horizontal: 24),
            itemCount: locations.length,
            separatorBuilder: (_, __) => Divider(height: 1, color: _textDark.withValues(alpha: 0.08)),
            itemBuilder: (context, index) {
              final location = locations[index];
              return ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(
                  location,
                  style: const TextStyle(
                    fontSize: 18,
                    color: _textDark,
                  ),
                ),
                trailing: const Icon(Icons.chevron_right_rounded, color: _almond),
                onTap: () => _onLocationTapped(location),
              );
            },
          ),
        ),
      ],
    );
  }
}
