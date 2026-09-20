import 'dart:ui' as ui;
import 'dart:typed_data';
import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('crop allows zoom and returns a decodable square image', (
    tester,
  ) async {
    final recorder = ui.PictureRecorder();
    Canvas(recorder).drawRect(
      const Rect.fromLTWH(0, 0, 800, 400),
      Paint()..color = Colors.orange,
    );
    final picture = recorder.endRecording();
    final image = await picture.toImage(800, 400);
    picture.dispose();
    List<int>? result;
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => TextButton(
            onPressed: () async {
              result = await Navigator.of(context).push<List<int>>(
                MaterialPageRoute(
                  builder: (_) => AvatarCropScreen(image: image),
                ),
              );
            },
            child: const Text('Open'),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Open'));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('avatar-crop-preview')), findsOneWidget);
    tester.widget<Slider>(find.byType(Slider)).onChanged!(2);
    await tester.pump();
    expect(tester.widget<Slider>(find.byType(Slider)).value, 2);
    await tester.tap(find.byType(FilledButton));
    await tester.runAsync(() async {
      await Future<void>.delayed(const Duration(milliseconds: 200));
    });
    await tester.pumpAndSettle();
    expect(result, isNotNull);
    await tester.runAsync(() async {
      final codec = await ui.instantiateImageCodec(Uint8List.fromList(result!));
      final frame = await codec.getNextFrame();
      expect(frame.image.width, 512);
      expect(frame.image.height, 512);
      frame.image.dispose();
      codec.dispose();
    });
    image.dispose();
  });
}
