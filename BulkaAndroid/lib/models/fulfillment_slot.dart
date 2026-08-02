part of '../main.dart';

class FulfillmentSlot {
  const FulfillmentSlot({
    required this.startsAt,
    required this.endsAt,
    required this.capacity,
    required this.remaining,
    this.timezoneOffsetMinutes = 300,
    this.serverTime,
  });

  final DateTime startsAt;
  final DateTime endsAt;
  final int capacity;
  final int remaining;
  final int timezoneOffsetMinutes;
  final DateTime? serverTime;

  DateTime get branchStartsAt =>
      branchWallClock(startsAt, timezoneOffsetMinutes);
  DateTime get branchEndsAt => branchWallClock(endsAt, timezoneOffsetMinutes);
  DateTime get branchServerTime => branchWallClock(
    serverTime ?? DateTime.now().toUtc(),
    timezoneOffsetMinutes,
  );

  factory FulfillmentSlot.fromJson(
    Map<String, dynamic> json, {
    int timezoneOffsetMinutes = 300,
    DateTime? serverTime,
  }) {
    return FulfillmentSlot(
      startsAt: DateTime.parse(_asString(json['startsAt'])).toUtc(),
      endsAt: DateTime.parse(_asString(json['endsAt'])).toUtc(),
      capacity: _asInt(json['capacity']),
      remaining: _asInt(json['remaining']),
      timezoneOffsetMinutes: timezoneOffsetMinutes,
      serverTime: serverTime?.toUtc(),
    );
  }
}

DateTime branchWallClock(DateTime instant, int timezoneOffsetMinutes) {
  final shifted = instant.toUtc().add(Duration(minutes: timezoneOffsetMinutes));
  return DateTime(
    shifted.year,
    shifted.month,
    shifted.day,
    shifted.hour,
    shifted.minute,
    shifted.second,
    shifted.millisecond,
    shifted.microsecond,
  );
}
