import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

class WalkingRewardsNative {
  static const channel = MethodChannel('com.bulka.bonus/walking_rewards');
  static bool get isIOS =>
      !kIsWeb && defaultTargetPlatform == TargetPlatform.iOS;
  static bool get isAndroid =>
      !kIsWeb && defaultTargetPlatform == TargetPlatform.android;
  static bool get isSupportedPlatform => isIOS || isAndroid;
  static Future<Map<String, dynamic>> capabilities() async {
    if (!isSupportedPlatform) return {'supported': false, 'authorized': false};
    try {
      // This native probe answers synchronously without permission, sensor or
      // network work. Reserve the timed proof operation for explicit sync.
      return await channel.invokeMapMethod<String, dynamic>('capabilities') ??
          {'supported': false, 'authorized': false};
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

  static Future<void> stop() async {
    if (!isAndroid) return;
    try {
      final stopped = await channel
          .invokeMethod<bool>('stop')
          .timeout(const Duration(seconds: 45));
      if (stopped != true) {
        throw PlatformException(code: 'WALKING_STOP_FAILED');
      }
    } on MissingPluginException {
      // An installed older Android binary has no walking subscription.
    }
  }
}
