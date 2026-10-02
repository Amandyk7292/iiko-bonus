import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

class WalkingRewardsNative {
  static const channel = MethodChannel('com.bulka.bonus/walking_rewards');
  static bool get isIOS =>
      !kIsWeb && defaultTargetPlatform == TargetPlatform.iOS;
  static Future<Map<String, dynamic>> capabilities() async {
    if (!isIOS) return {'supported': false, 'authorized': false};
    try {
      return await invoke('capabilities');
    } on MissingPluginException {
      return {'supported': false, 'authorized': false};
    } on PlatformException {
      return {'supported': false, 'authorized': false};
    } on TimeoutException {
      return {'supported': false, 'authorized': false};
    }
  }

  static Future<Map<String, dynamic>> invoke(
    String method, [
    Map<String, dynamic>? args,
  ]) async =>
      await channel
          .invokeMapMethod<String, dynamic>(method, args)
          .timeout(const Duration(seconds: 45)) ??
      {};
  static Future<void> openSettings() async {
    await channel.invokeMethod<bool>('openSettings');
  }
}
