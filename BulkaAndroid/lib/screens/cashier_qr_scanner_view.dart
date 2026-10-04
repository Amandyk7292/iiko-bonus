part of '../main.dart';

extension _CashierQrScannerView on _CashierQrScannerState {
  String get _messageKey => switch (_status) {
    _CashierScannerStatus.loading => 'cashier_scanner_loading',
    _CashierScannerStatus.denied => 'cashier_scanner_denied',
    _CashierScannerStatus.unavailable => 'cashier_scanner_unavailable',
    _CashierScannerStatus.paused => 'cashier_scanner_paused',
    _CashierScannerStatus.running =>
      _invalidQr ? 'cashier_scanner_invalid' : 'cashier_scanner_hint',
  };

  Widget _buildScanner() {
    final running = _status == _CashierScannerStatus.running;
    final loading = _status == _CashierScannerStatus.loading;
    return Scaffold(
      key: const ValueKey('cashier-live-scanner'),
      backgroundColor: Colors.black,
      body: Stack(
        children: [
          Positioned.fill(child: _camera.buildPreview()),
          Positioned.fill(
            child: ColoredBox(color: Colors.black.withValues(alpha: 0.2)),
          ),
          SafeArea(
            child: Column(
              children: [
                Container(
                  padding: const EdgeInsets.fromLTRB(16, 8, 8, 8),
                  color: Colors.black.withValues(alpha: 0.65),
                  child: Row(
                    children: [
                      Image.asset(
                        'assets/brand/bulka_logo.png',
                        width: 64,
                        height: 42,
                        fit: BoxFit.contain,
                        color: Colors.white,
                        semanticLabel: 'Bulka',
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Text(
                          'cashier_scanner_title'.tr,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 18,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                      IconButton(
                        key: const ValueKey('cashier-scanner-close'),
                        tooltip: 'cashier_scanner_close'.tr,
                        constraints: const BoxConstraints.tightFor(
                          width: 48,
                          height: 48,
                        ),
                        onPressed: () => _finish(null),
                        icon: const Icon(Icons.close, color: Colors.white),
                      ),
                    ],
                  ),
                ),
                Expanded(
                  child: LayoutBuilder(
                    builder: (context, constraints) {
                      final side = min(
                        300.0,
                        min(
                          constraints.maxWidth - 48,
                          constraints.maxHeight - 32,
                        ),
                      ).clamp(0.0, 300.0);
                      return Center(
                        child: loading
                            ? const CircularProgressIndicator(
                                color: _bulkaYellow,
                              )
                            : running
                            ? SizedBox.square(
                                dimension: side,
                                child: IgnorePointer(
                                  child: CustomPaint(
                                    painter: _CashierQrFrame(),
                                  ),
                                ),
                              )
                            : const Icon(
                                Icons.videocam_off_outlined,
                                size: 52,
                                color: Colors.white,
                              ),
                      );
                    },
                  ),
                ),
                ConstrainedBox(
                  constraints: BoxConstraints(
                    maxHeight: MediaQuery.sizeOf(context).height * 0.42,
                  ),
                  child: SingleChildScrollView(
                    child: Container(
                      width: double.infinity,
                      padding: const EdgeInsets.fromLTRB(24, 20, 24, 24),
                      color: Colors.black.withValues(alpha: 0.75),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Semantics(
                            liveRegion: true,
                            child: Text(
                              _messageKey.tr,
                              textAlign: TextAlign.center,
                              style: const TextStyle(
                                color: Colors.white,
                                fontSize: 16,
                                height: 1.4,
                              ),
                            ),
                          ),
                          if (!loading && !running) ...[
                            const SizedBox(height: 20),
                            FilledButton.icon(
                              key: const ValueKey('cashier-scanner-retry'),
                              onPressed: () => unawaited(_start()),
                              icon: const Icon(Icons.refresh),
                              label: Text('cashier_scanner_retry'.tr),
                            ),
                          ],
                        ],
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _CashierQrFrame extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final border = Paint()
      ..color = Colors.white.withValues(alpha: 0.45)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1;
    canvas.drawRRect(
      RRect.fromRectAndRadius(Offset.zero & size, const Radius.circular(20)),
      border,
    );
    final corner = Paint()
      ..color = _bulkaYellow
      ..style = PaintingStyle.stroke
      ..strokeWidth = 4
      ..strokeCap = StrokeCap.round;
    const edge = 28.0;
    for (final flipX in [false, true]) {
      for (final flipY in [false, true]) {
        canvas.save();
        canvas.translate(flipX ? size.width : 0, flipY ? size.height : 0);
        canvas.scale(flipX ? -1 : 1, flipY ? -1 : 1);
        canvas.drawPath(
          Path()
            ..moveTo(0, edge)
            ..lineTo(0, 20)
            ..quadraticBezierTo(0, 0, 20, 0)
            ..lineTo(edge, 0),
          corner,
        );
        canvas.restore();
      }
    }
  }

  @override
  bool shouldRepaint(covariant _CashierQrFrame oldDelegate) => false;
}
