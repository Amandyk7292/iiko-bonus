part of '../main.dart';

class AddressSelectionScreen extends StatefulWidget {
  const AddressSelectionScreen({super.key});

  @override
  State<AddressSelectionScreen> createState() => _AddressSelectionScreenState();
}

class _AddressSelectionScreenState extends State<AddressSelectionScreen> {
  final _repository = const AddressRepository();
  List<DeliveryAddress> _addresses = const [];
  String? _selectedId;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final results = await Future.wait<Object?>([
      _repository.loadAddresses(),
      _repository.loadSelectedAddressId(),
    ]);
    if (!mounted) return;
    final addresses = results[0] as List<DeliveryAddress>;
    final selectedId = results[1] as String?;
    setState(() {
      _addresses = addresses;
      _selectedId = addresses.any((item) => item.id == selectedId)
          ? selectedId
          : (addresses.isEmpty ? null : addresses.first.id);
      _loading = false;
    });
  }

  Future<void> _addAddress() async {
    final location = await Navigator.of(context).push<DeliveryLocation>(
      MaterialPageRoute(builder: (_) => const AddressMapScreen()),
    );
    if (!mounted || location == null) return;

    final address = await Navigator.of(context).push<DeliveryAddress>(
      MaterialPageRoute(
        builder: (_) => AddressDetailsScreen(location: location),
      ),
    );
    if (!mounted || address == null) return;

    await _repository.saveAddress(address);
    if (!mounted) return;
    setState(() {
      _addresses = [
        address,
        ..._addresses.where((item) => item.id != address.id),
      ];
      _selectedId = address.id;
    });
  }

  Future<void> _selectAddress(String id) async {
    setState(() => _selectedId = id);
    await _repository.selectAddress(id);
  }

  @override
  Widget build(BuildContext context) {
    final selected = _selectedId != null;

    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        centerTitle: true,
        leading: IconButton(
          onPressed: () => Navigator.of(context).pop(),
          icon: const Icon(Icons.chevron_left_rounded, size: 34),
          color: _cocoa.withValues(alpha: 0.56),
          tooltip: 'Назад',
        ),
        title: const Text(
          'Выберите адрес',
          style: TextStyle(
            fontFamily: _headingFont,
            fontSize: 30,
            fontWeight: FontWeight.w400,
          ),
        ),
        actions: [
          IconButton(
            onPressed: _addAddress,
            icon: const Icon(Icons.add_rounded, size: 32),
            color: _cocoa.withValues(alpha: 0.48),
            tooltip: 'add_address'.tr,
          ),
          const SizedBox(width: 14),
        ],
      ),
      body: SafeArea(
        top: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 16, 24, 0),
              child: Text(
                'my_addresses'.tr,
                style: const TextStyle(
                  color: Colors.black,
                  fontFamily: _headingFont,
                  fontSize: 24,
                  fontWeight: FontWeight.w400,
                ),
              ),
            ),
            Expanded(
              child: _loading
                  ? const Center(child: CircularProgressIndicator())
                  : _addresses.isEmpty
                  ? Center(
                      child: Text(
                        'no_addresses'.tr,
                        style: const TextStyle(
                          color: Colors.black,
                          fontSize: 22,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    )
                  : ListView.separated(
                      padding: const EdgeInsets.fromLTRB(24, 34, 24, 24),
                      itemCount: _addresses.length,
                      separatorBuilder: (_, _) => const SizedBox(height: 14),
                      itemBuilder: (context, index) {
                        final address = _addresses[index];
                        return _AddressListTile(
                          address: address,
                          selected: address.id == _selectedId,
                          onTap: () => _selectAddress(address.id),
                        );
                      },
                    ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 14, 24, 24),
              child: SizedBox(
                width: double.infinity,
                height: 78,
                child: GradientButton(
                  onPressed: selected
                      ? () => Navigator.of(context).pop()
                      : null,
                  height: 78,
                  child: const Text(
                    'Продолжить',
                    style: TextStyle(fontSize: 22, fontWeight: FontWeight.w400),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _AddressListTile extends StatelessWidget {
  const _AddressListTile({
    required this.address,
    required this.selected,
    required this.onTap,
  });

  final DeliveryAddress address;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(26),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(26),
        child: Container(
          constraints: const BoxConstraints(minHeight: 96),
          padding: const EdgeInsets.fromLTRB(22, 16, 16, 16),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(26),
            border: Border.all(color: _almond, width: 1.4),
          ),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text(
                      address.title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Colors.black,
                        fontSize: 20,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      address.displayAddress,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: _textDark.withValues(alpha: 0.48),
                        fontSize: 20,
                        height: 1.18,
                        fontWeight: FontWeight.w300,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              AnimatedContainer(
                duration: const Duration(milliseconds: 180),
                width: 34,
                height: 34,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: selected ? const Color(0xFFE3C477) : Colors.white,
                  border: Border.all(color: _almond),
                ),
                child: selected
                    ? const Icon(
                        Icons.check_rounded,
                        size: 25,
                        color: Colors.white,
                      )
                    : null,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
