part of '../main.dart';

class AvatarCropScreen extends StatefulWidget {
  const AvatarCropScreen({super.key, required this.image});
  final ui.Image image;
  @override
  State<AvatarCropScreen> createState() => _AvatarCropScreenState();
}

class _AvatarCropScreenState extends State<AvatarCropScreen> {
  double _zoom = 1;
  double _startZoom = 1;
  Offset _center = const Offset(.5, .5);
  bool _saving = false;

  Rect get _source {
    final width = widget.image.width.toDouble();
    final height = widget.image.height.toDouble();
    final edge = min(width, height) / _zoom;
    return Rect.fromLTWH(
      (_center.dx * width - edge / 2).clamp(0, width - edge),
      (_center.dy * height - edge / 2).clamp(0, height - edge),
      edge,
      edge,
    );
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      final recorder = ui.PictureRecorder();
      Canvas(recorder).drawImageRect(
        widget.image,
        _source,
        const Rect.fromLTWH(0, 0, 512, 512),
        Paint()..filterQuality = FilterQuality.high,
      );
      final picture = recorder.endRecording();
      final output = await picture.toImage(512, 512);
      picture.dispose();
      final bytes = await output.toByteData(format: ui.ImageByteFormat.png);
      output.dispose();
      if (bytes == null) throw StateError('Image encoding failed');
      if (mounted) Navigator.pop(context, bytes.buffer.asUint8List());
    } catch (_) {
      if (mounted) {
        setState(() => _saving = false);
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('avatar_invalid_format'.tr)));
      }
    }
  }

  @override
  Widget build(BuildContext context) => PopScope(
    canPop: !_saving,
    child: Scaffold(
      appBar: AppBar(title: Text('avatar_crop_title'.tr)),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            children: [
              Text('avatar_crop_hint'.tr, textAlign: TextAlign.center),
              Expanded(
                child: Center(
                  child: LayoutBuilder(
                    builder: (context, constraints) {
                      final edge = min(
                        constraints.maxWidth,
                        constraints.maxHeight,
                      ).clamp(1.0, 360.0);
                      return GestureDetector(
                        onScaleStart: (_) => _startZoom = _zoom,
                        onScaleUpdate: _saving
                            ? null
                            : (details) => setState(() {
                                final rect = _source;
                                _zoom = (_startZoom * details.scale).clamp(
                                  1.0,
                                  4.0,
                                );
                                final dx =
                                    rect.center.dx -
                                    details.focalPointDelta.dx *
                                        rect.width /
                                        edge;
                                final dy =
                                    rect.center.dy -
                                    details.focalPointDelta.dy *
                                        rect.height /
                                        edge;
                                final half =
                                    min(
                                      widget.image.width,
                                      widget.image.height,
                                    ) /
                                    _zoom /
                                    2;
                                _center = Offset(
                                  dx.clamp(half, widget.image.width - half) /
                                      widget.image.width,
                                  dy.clamp(half, widget.image.height - half) /
                                      widget.image.height,
                                );
                              }),
                        child: ClipOval(
                          child: CustomPaint(
                            key: const ValueKey('avatar-crop-preview'),
                            size: Size.square(edge),
                            painter: _AvatarCropPainter(widget.image, _source),
                          ),
                        ),
                      );
                    },
                  ),
                ),
              ),
              Slider(
                value: _zoom,
                min: 1,
                max: 4,
                label: '${_zoom.toStringAsFixed(1)}×',
                onChanged: _saving
                    ? null
                    : (value) => setState(() => _zoom = value),
              ),
              FilledButton(
                onPressed: _saving ? null : _save,
                child: Text(
                  _saving ? 'avatar_crop_processing'.tr : 'avatar_crop_use'.tr,
                ),
              ),
              TextButton(
                onPressed: _saving ? null : () => Navigator.pop(context),
                child: Text('cancel_btn'.tr),
              ),
            ],
          ),
        ),
      ),
    ),
  );
}

class _AvatarCropPainter extends CustomPainter {
  _AvatarCropPainter(this.image, this.source);
  final ui.Image image;
  final Rect source;
  @override
  void paint(Canvas canvas, Size size) => canvas.drawImageRect(
    image,
    source,
    Offset.zero & size,
    Paint()..filterQuality = FilterQuality.high,
  );
  @override
  bool shouldRepaint(_AvatarCropPainter old) =>
      old.source != source || old.image != image;
}
