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
  bool _loadFailed = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _loadFailed = false;
    });
    try {
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
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _loadFailed = true;
      });
    }
  }

  Future<void> _addAddress() async {
    BulkaMotion.lightImpact();
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

    try {
      await _repository.saveAddress(address);
      if (!mounted) return;
      setState(() {
        _addresses = [
          address,
          ..._addresses.where((item) => item.id != address.id),
        ];
        _selectedId = address.id;
      });
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(localizeErrorMessage(error))));
    }
  }

  Future<void> _selectAddress(String id) async {
    BulkaMotion.selection();
    final previous = _selectedId;
    setState(() => _selectedId = id);
    try {
      await _repository.selectAddress(id);
    } catch (error) {
      if (!mounted) return;
      setState(() => _selectedId = previous);
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(localizeErrorMessage(error))));
    }
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
          tooltip: 'back_tooltip'.tr,
        ),
        title: Text(
          'select_address_title'.tr,
          style: const TextStyle(
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
                  : _loadFailed
                  ? _AddressState(
                      icon: Icons.cloud_off_rounded,
                      title: 'error_generic'.tr,
                      subtitle: 'error_network'.tr,
                      actionLabel: 'retry_btn'.tr,
                      onAction: _load,
                    )
                  : _addresses.isEmpty
                  ? _AddressState(
                      icon: Icons.location_on_outlined,
                      title: 'no_addresses'.tr,
                      subtitle: 'no_addresses_sub'.tr,
                      actionLabel: 'add_address'.tr,
                      onAction: _addAddress,
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
                  child: Text(
                    'continue_btn'.tr,
                    style: const TextStyle(
                      fontSize: 22,
                      fontWeight: FontWeight.w400,
                    ),
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

class _AddressState extends StatelessWidget {
  const _AddressState({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.actionLabel,
    required this.onAction,
  });

  final IconData icon;
  final String title;
  final String subtitle;
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
            Icon(icon, color: _caramel, size: 44),
            const SizedBox(height: 14),
            Text(
              title,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: _textDark,
                fontFamily: _headingFont,
                fontSize: 22,
                fontWeight: FontWeight.w400,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              subtitle,
              textAlign: TextAlign.center,
              style: TextStyle(
                color: _textDark.withValues(alpha: 0.62),
                fontSize: 15,
                height: 1.4,
              ),
            ),
            const SizedBox(height: 20),
            SizedBox(
              width: double.infinity,
              child: GradientButton(
                onPressed: onAction,
                child: Text(actionLabel),
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
                duration: BulkaMotion.duration(context, BulkaMotion.fast),
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
