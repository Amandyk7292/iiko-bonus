import 'package:bulka_bonus/main.dart';
import 'package:bulka_bonus/widgets/yandex_map/yandex_map.dart';
import 'package:flutter/material.dart';

// A local visual fixture. It never creates or pays for an order or calls a courier.
CustomerOrder trackingPreviewOrder() => CustomerOrder.fromJson({
  'id': 'tracking-preview',
  'number': 1,
  'branch': 'Premium Plaza',
  'fulfillmentType': 'delivery',
  'paymentStatus': 'paid',
  'orderStatus': 'ready',
  'deliveryStatus': 'in_transit',
  'deliveryOrigin': {
    'city': 'Актау',
    'address': '18А микрорайон, 1',
    'latitude': 43.677412,
    'longitude': 51.13768,
  },
  'deliveryAddress': {
    'label': 'ЖК Гаухартас',
    'city': 'Актау',
    'address': '34-й микрорайон',
    'house': '14',
    'entrance': '3',
    'floor': '4',
    'apartment': '37',
    'latitude': 43.6881759,
    'longitude': 51.1614135,
  },
  'courier': {
    'id': 'preview-courier',
    'name': 'Курьер',
    'vehicle': 'Geely SC7',
    'latitude': 43.67918,
    'longitude': 51.140454,
  },
});

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(MaterialApp(theme: buildBulkaTheme(), home: const TrackingPreview()));
}

class TrackingPreview extends StatefulWidget {
  const TrackingPreview({super.key});
  @override
  State<TrackingPreview> createState() => _TrackingPreviewState();
}

class _TrackingPreviewState extends State<TrackingPreview> {
  final controller = YandexMapController();
  @override
  void dispose() {
    controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: Colors.white,
    appBar: AppBar(title: const Text('Проверка карты')),
    body: ListView(
      padding: const EdgeInsets.all(20),
      children: [
        const Text('Пример отображения, без вызова курьера'),
        const SizedBox(height: 18),
        OrderTrackingMap(
          points: orderTrackingPoints(trackingPreviewOrder()),
          controller: controller,
        ),
      ],
    ),
  );
}
