part of '../main.dart';

class AddressSelectionScreen extends StatefulWidget {
  const AddressSelectionScreen({this.api, super.key});

  final BulkaApiClient? api;

  @override
  State<AddressSelectionScreen> createState() => _AddressSelectionScreenState();
}

class _AddressSelectionScreenState extends State<AddressSelectionScreen> {
  late final AddressRepository _repository;
  List<DeliveryAddress> _addresses = const [];
  String? _selectedId;
  bool _loading = true;
  bool _loadFailed = false;

  @override
  void initState() {
    super.initState();
    _repository = AddressRepository(api: widget.api);
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
      MaterialPageRoute(builder: (_) => AddressMapScreen(api: widget.api)),
    );
    if (!mounted || location == null) return;

    final address = await Navigator.of(context).push<DeliveryAddress>(
      MaterialPageRoute(
        builder: (_) => AddressDetailsScreen(location: location),
      ),
    );
    if (!mounted || address == null) return;

    try {
      final saved = await _repository.saveAddress(address);
      if (!mounted) return;
      setState(() {
        _addresses = [
          saved,
          ..._addresses.where((item) => item.id != saved.id),
        ];
        _selectedId = saved.id;
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

  Future<void> _deleteAddress(DeliveryAddress address) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text('delete_address_title'.tr),
        content: Text(
          'delete_address_body'.trArgs({'address': address.displayAddress}),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: Text('cancel_btn'.tr),
          ),
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            style: TextButton.styleFrom(foregroundColor: _errorRed),
            child: Text('delete_btn'.tr),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await _repository.deleteAddress(address.id);
      if (!mounted) return;
      final remaining = _addresses
          .where((item) => item.id != address.id)
          .toList();
      setState(() {
        _addresses = remaining;
        if (_selectedId == address.id) {
          _selectedId = remaining.isEmpty ? null : remaining.first.id;
        }
      });
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(localizeErrorMessage(error))));
    }
  }

  Future<void> _continue() async {
    DeliveryAddress? selected;
    for (final address in _addresses) {
      if (address.id == _selectedId) {
        selected = address;
        break;
      }
    }
    if (selected == null) return;
    await _repository.selectAddress(selected.id);
    if (mounted) Navigator.of(context).pop(selected);
  }

  @override
  Widget build(BuildContext context) {
    final selected = _selectedId != null;

    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        centerTitle: true,
        titleSpacing: 0,
        leading: IconButton(
          onPressed: () => Navigator.of(context).pop(),
          icon: const Icon(Icons.chevron_left_rounded, size: 34),
          color: _cocoa.withValues(alpha: 0.56),
          tooltip: 'back_tooltip'.tr,
        ),
        title: Text(
          'select_address_title'.tr,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(
            fontFamily: _brandFont,
            fontSize: 22,
            fontWeight: FontWeight.w700,
          ),
        ),
        actions: [
          IconButton(
            onPressed: _addAddress,
            icon: const Icon(Icons.add_rounded, size: 32),
            color: _cocoa.withValues(alpha: 0.48),
            tooltip: 'add_address'.tr,
          ),
          const SizedBox(width: 6),
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
                          onDelete: () => _deleteAddress(address),
                        );
                      },
                    ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 14, 24, 24),
              child: SizedBox(
                width: double.infinity,
                height: 60,
                child: GradientButton(
                  onPressed: selected ? _continue : null,
                  height: 60,
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
    return LayoutBuilder(
      builder: (context, constraints) => SingleChildScrollView(
        padding: const EdgeInsets.all(28),
        child: ConstrainedBox(
          constraints: BoxConstraints(
            minHeight: max(0, constraints.maxHeight - 56),
          ),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
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
      ),
    );
  }
}

class _AddressListTile extends StatelessWidget {
  const _AddressListTile({
    required this.address,
    required this.selected,
    required this.onTap,
    required this.onDelete,
  });

  final DeliveryAddress address;
  final bool selected;
  final VoidCallback onTap;
  final VoidCallback onDelete;

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
                        fontSize: 18,
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
                        fontSize: 16,
                        height: 1.18,
                        fontWeight: FontWeight.w300,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
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
                  PopupMenuButton<String>(
                    tooltip: 'address_actions'.tr,
                    icon: const Icon(Icons.more_vert_rounded),
                    onSelected: (value) {
                      if (value == 'delete') onDelete();
                    },
                    itemBuilder: (_) => [
                      PopupMenuItem(
                        value: 'delete',
                        child: Row(
                          children: [
                            const Icon(
                              Icons.delete_outline_rounded,
                              color: _errorRed,
                            ),
                            const SizedBox(width: 10),
                            Text('delete_btn'.tr),
                          ],
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
