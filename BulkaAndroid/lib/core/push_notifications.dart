part of '../main.dart';

@pragma('vm:entry-point')
Future<void> _firebaseBackgroundMessage(RemoteMessage message) async {
  await Firebase.initializeApp();
}

abstract final class PushNotifications {
  static bool _ready = false;
  static StreamSubscription<String>? _tokenSubscription;

  static Future<void> initialize() async {
    try {
      await Firebase.initializeApp();
      _ready = true;
      FirebaseMessaging.onBackgroundMessage(_firebaseBackgroundMessage);
      await FirebaseMessaging.instance.setForegroundNotificationPresentationOptions(
        alert: true,
        badge: true,
        sound: true,
      );
    } catch (error) {
      debugPrint('Push initialization unavailable: $error');
    }
  }

  static Future<void> register(BulkaApiClient api) async {
    if (!_ready) return;
    try {
      final settings = await FirebaseMessaging.instance.requestPermission(
        alert: true,
        badge: true,
        sound: true,
      );
      if (settings.authorizationStatus == AuthorizationStatus.denied) return;
      if (defaultTargetPlatform == TargetPlatform.iOS) {
        final apnsToken = await FirebaseMessaging.instance.getAPNSToken();
        if (apnsToken == null) return;
      }
      final token = await FirebaseMessaging.instance.getToken();
      if (token != null && token.isNotEmpty) await api.registerFcmToken(token);
      _tokenSubscription ??= FirebaseMessaging.instance.onTokenRefresh.listen(
        (nextToken) => api.registerFcmToken(nextToken).catchError((_) {}),
      );
    } catch (error) {
      debugPrint('Push registration unavailable: $error');
    }
  }

  static Future<void> unregister(BulkaApiClient api) async {
    if (!_ready) return;
    try {
      await api.clearFcmToken();
    } catch (_) {}
  }
}
