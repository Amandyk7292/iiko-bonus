part of '../main.dart';

List<YandexTrackingPoint> orderTrackingPoints(
  CustomerOrder order, {
  bool includeCourier = true,
}) {
  bool valid(double? latitude, double? longitude) =>
      latitude != null &&
      longitude != null &&
      latitude.isFinite &&
      longitude.isFinite &&
      latitude.abs() <= 90 &&
      longitude.abs() <= 180 &&
      !(latitude == 0 && longitude == 0);
  final origin = order.deliveryOrigin;
  final address = order.deliveryAddress;
  final courier = order.courier;
  return [
    if (valid(origin?.latitude, origin?.longitude))
      YandexTrackingPoint(
        kind: 'pickup',
        point: LatLng(origin!.latitude, origin.longitude),
        label: 'order_map_sender'.tr,
        address: [
          order.branch,
          origin.address,
        ].where((part) => part.isNotEmpty).toSet().join('\n'),
      ),
    if (address != null && address.hasValidCoordinates)
      YandexTrackingPoint(
        kind: 'recipient',
        point: LatLng(address.location.latitude, address.location.longitude),
        label: 'order_map_recipient'.tr,
        address: [
          if (address.title.isNotEmpty) address.title,
          address.location.fullAddress,
          if (address.house.isNotEmpty) '${'house_label'.tr} ${address.house}',
          if ((address.entrance ?? '').isNotEmpty)
            '${'entrance_label'.tr} ${address.entrance}',
          if ((address.floor ?? '').isNotEmpty)
            '${'floor_label'.tr} ${address.floor}',
          if ((address.apartment ?? '').isNotEmpty)
            '${'apartment_label'.tr} ${address.apartment}',
        ].join(' · '),
      ),
    if (includeCourier && valid(courier?.latitude, courier?.longitude))
      YandexTrackingPoint(
        kind: 'courier',
        point: LatLng(courier!.latitude!, courier.longitude!),
        label: 'order_map_courier'.tr,
        address: [
          courier.name,
          courier.vehicle ?? '',
        ].where((part) => part.isNotEmpty).join(' · '),
      ),
  ];
}

class OrderTrackingMap extends StatelessWidget {
  const OrderTrackingMap({
    required this.points,
    required this.controller,
    super.key,
  });
  final List<YandexTrackingPoint> points;
  final YandexMapController controller;

  @override
  Widget build(BuildContext context) => points.isEmpty
      ? const SizedBox.shrink()
      : Column(
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(BulkaRadii.control),
              child: SizedBox(
                height: 280,
                child: YandexMapView(
                  controller: controller,
                  center: points.first.point,
                  selectedPoint: null,
                  trackingPoints: points,
                  zoom: 15,
                  branches: const [],
                  semanticLabel: 'order_courier_live'.tr,
                  unavailableLabel: 'map_unavailable'.tr,
                  interactive: true,
                  language: appLanguageNotifier.value,
                ),
              ),
            ),
            _TrackingPointLegend(points: points, controller: controller),
          ],
        );
}

class _TrackingPointLegend extends StatelessWidget {
  const _TrackingPointLegend({required this.points, required this.controller});
  final List<YandexTrackingPoint> points;
  final YandexMapController controller;

  @override
  Widget build(BuildContext context) => Column(
    children: [
      for (final point in points)
        Padding(
          padding: const EdgeInsets.only(top: 12),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(
                  color: switch (point.kind) {
                    'courier' => const Color(0xFF1565C0),
                    'recipient' => const Color(0xFFFFBC08),
                    _ => const Color(0xFF633317),
                  },
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(
                  switch (point.kind) {
                    'courier' => Icons.directions_car_rounded,
                    'recipient' => Icons.home_rounded,
                    _ => Icons.storefront_rounded,
                  },
                  color: point.kind == 'recipient'
                      ? const Color(0xFF51290F)
                      : Colors.white,
                  size: 23,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      point.label,
                      style: const TextStyle(fontWeight: FontWeight.w700),
                    ),
                    Text(
                      point.address,
                      style: TextStyle(
                        color: context.bulkaColors.mutedText,
                        fontSize: 14,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      const SizedBox(height: 8),
      TextButton.icon(
        onPressed: controller.fitTrackingPoints,
        icon: const Icon(Icons.center_focus_strong_rounded),
        label: Text('order_map_show_all'.tr),
      ),
    ],
  );
}
