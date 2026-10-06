part of '../main.dart';

bool _validPickupPhotoId(String id) => RegExp(
  r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
  caseSensitive: false,
).hasMatch(id);

extension _CheckoutPickupPhotoLayout on _CheckoutScreenState {
  Widget _buildPickupPhotoSection(BuildContext context) {
    final branchId = _branchId ?? '';
    final scope = widget.api.sessionCacheScope;
    final cartScope = widget.cartRevision ?? jsonEncode(widget.cartItems);
    return _CheckoutPickupPhotoSection(
      key: ValueKey(('checkout-pickup-photo', scope, branchId, cartScope)),
      api: widget.api,
      branchId: branchId,
      cartScope: cartScope,
      locked: _isSubmitting || _pickupPhotoLocked,
      capture: widget.capturePickupPhoto,
      onPhotoChanged: (photoId) {
        if (!mounted ||
            branchId != _branchId ||
            scope != widget.api.sessionCacheScope ||
            _pickupPhotoId == photoId) {
          return;
        }
        _updateCheckoutState(() => _pickupPhotoId = photoId);
      },
      onBlockingChanged: (blocking) {
        if (!mounted ||
            branchId != _branchId ||
            scope != widget.api.sessionCacheScope ||
            _isManagingPickupPhoto == blocking) {
          return;
        }
        _updateCheckoutState(() => _isManagingPickupPhoto = blocking);
      },
    );
  }
}

class _CheckoutPickupPhotoSection extends StatefulWidget {
  const _CheckoutPickupPhotoSection({
    super.key,
    required this.api,
    required this.branchId,
    required this.cartScope,
    required this.locked,
    required this.onPhotoChanged,
    required this.onBlockingChanged,
    this.capture,
  });

  final BulkaApiClient api;
  final String branchId;
  final String cartScope;
  final bool locked;
  final Future<XFile?> Function()? capture;
  final ValueChanged<String?> onPhotoChanged;
  final ValueChanged<bool> onBlockingChanged;

  @override
  State<_CheckoutPickupPhotoSection> createState() =>
      _CheckoutPickupPhotoSectionState();
}

class _CheckoutPickupPhotoSectionState
    extends State<_CheckoutPickupPhotoSection> {
  bool _available = false;
  bool _busy = false;
  bool _expired = false;
  Uint8List? _bytes;
  String _mimeType = 'image/jpeg';
  String? _photoId;
  String? _restoringId;
  String? _error;
  DateTime? _expiresAt;
  int _revision = 0;
  late final String? _session;
  late final String _draftKey;
  Future<void>? _draftWrite;
  _LiveRefresh? _live;

  bool get _sameOwner => _session == widget.api.sessionCacheScope;
  bool get _blocking =>
      (_busy && !(widget.locked && _restoringId != null)) ||
      (_bytes != null && _photoId == null) ||
      (_restoringId != null && !widget.locked);

  @override
  void initState() {
    super.initState();
    _session = widget.api.sessionCacheScope;
    _draftKey = customerPreferenceKey('checkout_pickup_photo', _session);
    _live = _LiveRefresh(
      widget.api,
      {'checkout', 'settings'},
      _checkCapability,
      busy: () => _busy || widget.locked,
    );
    unawaited(_initialize());
  }

  @override
  void dispose() {
    _revision++;
    _live?.dispose();
    super.dispose();
  }

  void _publish() {
    if (!mounted || !_sameOwner) return;
    widget.onPhotoChanged(_photoId);
    widget.onBlockingChanged(_blocking);
  }

  Future<void> _checkCapability() async {
    if (widget.branchId.isEmpty || !_sameOwner) return;
    try {
      final available = await widget.api.isPickupOrderPhotoAvailable(
        widget.branchId,
      );
      if (mounted && _sameOwner) setState(() => _available = available);
    } catch (_) {
      if (mounted && _sameOwner) setState(() => _available = false);
    }
  }

  Future<void> _initialize() async {
    unawaited(_checkCapability());
    final prefs = await SharedPreferences.getInstance();
    if (!mounted || !_sameOwner) return;
    Map<String, dynamic> draft = const {};
    try {
      draft = _asMap(jsonDecode(prefs.getString(_draftKey) ?? '{}'));
    } catch (_) {
      /* Invalid local drafts never authorize an attachment. */
    }
    final id = _asString(draft['photoId']);
    final expiry = DateTime.tryParse(_asString(draft['expiresAt']));
    if (!_validPickupPhotoId(id) ||
        expiry == null ||
        draft['cartScope'] != widget.cartScope ||
        draft['branchId'] != widget.branchId) {
      _publish();
      return;
    }
    setState(() {
      _restoringId = id;
      _expiresAt = expiry;
      _photoId = widget.locked ? id : null;
      _expired = !widget.locked && !expiry.isAfter(DateTime.now().toUtc());
      if (_expired) _error = 'checkout_photo_expired'.tr;
    });
    _publish();
    if (!_expired) await _restoreImage();
  }

  Future<void> _restoreImage() async {
    final id = _restoringId;
    if (id == null || _busy || !_sameOwner) return;
    final revision = ++_revision;
    setState(() {
      _busy = true;
      _error = null;
    });
    _publish();
    try {
      final bytes = await widget.api.getPickupOrderPhotoImage(id);
      if (!mounted || revision != _revision || !_sameOwner) return;
      setState(() {
        _bytes = bytes;
        _photoId = id;
        _restoringId = null;
      });
    } catch (error) {
      if (!mounted || revision != _revision || !_sameOwner) return;
      setState(() {
        _expired =
            !widget.locked &&
            error is ApiException &&
            (error.statusCode == 410 || error.code == 'PICKUP_PHOTO_EXPIRED');
        _error =
            (_expired ? 'checkout_photo_expired' : 'checkout_photo_load_error')
                .tr;
      });
    } finally {
      if (mounted && revision == _revision && _sameOwner) {
        setState(() => _busy = false);
        _publish();
      }
    }
  }

  Future<void> _capturePhoto() async {
    if (_busy || widget.locked || !_available || !_sameOwner) return;
    final revision = ++_revision;
    setState(() {
      _busy = true;
      _error = null;
    });
    _publish();
    try {
      final file =
          await (widget.capture?.call() ??
              ImagePicker().pickImage(
                source: ImageSource.camera,
                preferredCameraDevice: CameraDevice.front,
                imageQuality: 82,
                maxWidth: 1200,
                maxHeight: 1600,
              ));
      if (file == null || !mounted || revision != _revision || !_sameOwner) {
        return;
      }
      if (await file.length() > 5 * 1024 * 1024) {
        throw ApiException('checkout_photo_too_large'.tr);
      }
      final bytes = await file.readAsBytes();
      if (!mounted || revision != _revision || !_sameOwner) return;
      await pickup_photo_orientation.loadLibrary();
      final choices = await compute(
        pickup_photo_orientation.preparePickupPhoto,
        bytes,
      );
      if (!mounted || revision != _revision || !_sameOwner) return;
      final selected = await _choosePhoto(choices);
      if (selected == null ||
          !mounted ||
          revision != _revision ||
          !_sameOwner ||
          widget.locked) {
        return;
      }
      final previousId = _photoId ?? _restoringId;
      setState(() {
        _bytes = selected;
        _photoId = null;
        _restoringId = null;
        _expired = false;
        _mimeType = 'image/jpeg';
      });
      _publish();
      await _uploadPhoto(revision, previousId: previousId);
    } catch (error) {
      if (mounted && revision == _revision && _sameOwner) {
        setState(
          () => _error = error is ApiException
              ? localizeErrorMessage(error)
              : error is FormatException
              ? 'checkout_photo_prepare_error'.tr
              : 'checkout_photo_capture_error'.tr,
        );
      }
    } finally {
      if (mounted && revision == _revision && _sameOwner) {
        setState(() => _busy = false);
        _publish();
      }
    }
  }

  Future<Uint8List?> _choosePhoto(Map<String, Uint8List> choices) {
    var mirrored = false;
    return showModalBottomSheet<Uint8List>(
      context: context,
      sheetAnimationStyle: BulkaMotion.sheetStyle(context),
      isScrollControlled: true,
      useSafeArea: true,
      showDragHandle: true,
      constraints: const BoxConstraints(maxWidth: 560),
      builder: (context) => StatefulBuilder(
        builder: (context, setSheetState) {
          final selected = choices[mirrored ? 'mirrored' : 'original']!;
          return SingleChildScrollView(
            padding: EdgeInsets.fromLTRB(
              20,
              0,
              20,
              16 + MediaQuery.viewPaddingOf(context).bottom,
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  'checkout_photo_title'.tr,
                  style: const TextStyle(
                    fontFamily: _headingFont,
                    fontWeight: FontWeight.w700,
                    fontSize: BulkaTypeScale.body,
                  ),
                ),
                const SizedBox(height: 16),
                ClipRRect(
                  borderRadius: BorderRadius.circular(BulkaRadii.control),
                  child: Image.memory(
                    selected,
                    key: const ValueKey(
                      'checkout-pickup-photo-confirm-preview',
                    ),
                    height: min(
                      360.0,
                      MediaQuery.sizeOf(context).height * 0.45,
                    ),
                    fit: BoxFit.contain,
                  ),
                ),
                const SizedBox(height: 12),
                Align(
                  alignment: Alignment.center,
                  child: Semantics(
                    toggled: mirrored,
                    child: TextButton(
                      key: const ValueKey('checkout-mirror-pickup-photo'),
                      style: TextButton.styleFrom(
                        backgroundColor: mirrored
                            ? Theme.of(context).colorScheme.primaryContainer
                            : null,
                      ),
                      onPressed: () =>
                          setSheetState(() => mirrored = !mirrored),
                      child: Text('checkout_photo_mirror'.tr),
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: TextButton(
                        key: const ValueKey('checkout-cancel-pickup-photo'),
                        onPressed: () => Navigator.pop(context),
                        child: Text('cancel_btn'.tr),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      flex: 2,
                      child: FilledButton(
                        key: const ValueKey('checkout-use-pickup-photo'),
                        onPressed: () => Navigator.pop(context, selected),
                        child: Text('checkout_photo_use'.tr),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          );
        },
      ),
    );
  }

  Future<void> _uploadPhoto(int revision, {String? previousId}) async {
    final bytes = _bytes;
    if (bytes == null) return;
    final result = await widget.api.uploadPickupOrderPhoto(
      bytes: bytes,
      mimeType: _mimeType,
    );
    final id = _asString(result['photoId']);
    final expiry = DateTime.tryParse(_asString(result['expiresAt']));
    if (!mounted || revision != _revision || !_sameOwner) {
      if (_sameOwner) _discardRemote(id);
      return;
    }
    if (!_validPickupPhotoId(id) ||
        expiry == null ||
        !expiry.isAfter(DateTime.now().toUtc())) {
      throw ApiException('checkout_photo_upload_error'.tr);
    }
    setState(() {
      _photoId = id;
      _expiresAt = expiry;
      _error = null;
    });
    await _persistPhoto();
    if (previousId != null && previousId != id) _discardRemote(previousId);
  }

  Future<void> _retryPhoto() async {
    if (_busy || !_sameOwner) return;
    if (_expired) return _capturePhoto();
    if (_restoringId != null) return _restoreImage();
    if (widget.locked) return;
    if (_bytes == null) return _capturePhoto();
    final revision = ++_revision;
    setState(() {
      _busy = true;
      _error = null;
    });
    _publish();
    try {
      await _uploadPhoto(revision);
    } catch (_) {
      if (mounted && revision == _revision && _sameOwner) {
        setState(() => _error = 'checkout_photo_upload_error'.tr);
      }
    } finally {
      if (mounted && revision == _revision && _sameOwner) {
        setState(() => _busy = false);
        _publish();
      }
    }
  }

  void _removePhoto() {
    if (widget.locked || !_sameOwner) return;
    final id = _photoId ?? _restoringId;
    _revision++;
    setState(() {
      _bytes = null;
      _photoId = null;
      _restoringId = null;
      _expiresAt = null;
      _error = null;
      _busy = false;
      _expired = false;
    });
    _publish();
    unawaited(_persistPhoto());
    if (id != null) _discardRemote(id);
  }

  void _discardRemote(String id) {
    if (!_validPickupPhotoId(id) || !_sameOwner) return;
    unawaited(widget.api.removePickupOrderPhoto(id).catchError((Object _) {}));
  }

  Future<void> _persistPhoto() {
    final previous = _draftWrite;
    final id = _photoId;
    final expiry = _expiresAt;
    final revision = _revision;
    final write = () async {
      if (previous != null) await previous;
      final prefs = await SharedPreferences.getInstance();
      if (!_sameOwner || revision != _revision) return;
      if (id == null || expiry == null) {
        await prefs.remove(_draftKey);
      } else {
        await prefs.setString(
          _draftKey,
          jsonEncode({
            'photoId': id,
            'expiresAt': expiry.toUtc().toIso8601String(),
            'cartScope': widget.cartScope,
            'branchId': widget.branchId,
          }),
        );
      }
    }();
    _draftWrite = write;
    return write;
  }

  @override
  Widget build(BuildContext context) {
    if (!_sameOwner ||
        (!_available && _bytes == null && _restoringId == null) ||
        (widget.locked && _bytes == null && _restoringId == null)) {
      return const SizedBox.shrink();
    }
    final colors = context.bulkaColors;
    final hasPhoto = _bytes != null || _restoringId != null;
    return Container(
      key: const ValueKey('checkout-pickup-photo'),
      margin: const EdgeInsets.only(top: 28),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: colors.surfaceCream,
        borderRadius: BorderRadius.circular(BulkaRadii.card),
        border: Border.all(
          color: colors.cardBorder,
          width: BulkaStrokes.hairline,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'checkout_photo_title'.tr,
            style: const TextStyle(
              fontFamily: _headingFont,
              fontWeight: FontWeight.w700,
              fontSize: BulkaTypeScale.body,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            'checkout_photo_gift'.tr,
            style: TextStyle(
              fontSize: BulkaTypeScale.bodySmall,
              color: colors.mutedText,
            ),
          ),
          const SizedBox(height: 14),
          if (_bytes != null) ...[
            ClipRRect(
              borderRadius: BorderRadius.circular(BulkaRadii.control),
              child: Image.memory(
                _bytes!,
                key: const ValueKey('checkout-pickup-photo-preview'),
                height: 180,
                fit: BoxFit.contain,
                errorBuilder: (_, _, _) => SizedBox(
                  height: 100,
                  child: Center(child: Text('checkout_photo_load_error'.tr)),
                ),
              ),
            ),
            const SizedBox(height: 12),
          ],
          if (_busy) ...[
            const Center(
              child: SizedBox.square(
                dimension: 24,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
            ),
            const SizedBox(height: 12),
          ],
          if (_error != null) ...[
            Semantics(
              liveRegion: true,
              child: Text(
                _error!,
                key: const ValueKey('checkout-pickup-photo-error'),
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: colors.danger,
                  fontSize: BulkaTypeScale.bodySmall,
                ),
              ),
            ),
            const SizedBox(height: 10),
            if (widget.locked && _restoringId != null)
              TextButton(
                onPressed: _busy ? null : _retryPhoto,
                child: Text('retry_btn'.tr),
              ),
          ],
          if (!widget.locked)
            Row(
              children: [
                Expanded(
                  child: FilledButton.icon(
                    key: const ValueKey('checkout-capture-pickup-photo'),
                    onPressed: _busy
                        ? null
                        : _expired
                        ? _available
                              ? _capturePhoto
                              : null
                        : _error != null && hasPhoto
                        ? _retryPhoto
                        : _available
                        ? _capturePhoto
                        : null,
                    icon: Icon(
                      _error != null && hasPhoto
                          ? Icons.refresh_rounded
                          : Icons.camera_alt_rounded,
                      size: 20,
                    ),
                    label: Text(
                      (_expired
                              ? 'checkout_photo_replace'
                              : _error != null && hasPhoto
                              ? 'retry_btn'
                              : hasPhoto
                              ? 'checkout_photo_replace'
                              : 'checkout_photo_capture')
                          .tr,
                    ),
                  ),
                ),
                if (hasPhoto) ...[
                  const SizedBox(width: 8),
                  IconButton(
                    key: const ValueKey('checkout-remove-pickup-photo'),
                    tooltip: 'checkout_photo_remove'.tr,
                    onPressed: _removePhoto,
                    icon: const Icon(Icons.delete_outline_rounded),
                  ),
                ],
              ],
            ),
        ],
      ),
    );
  }
}
