part of '../main.dart';

@pragma('vm:entry-point')
Future<void> _firebaseBackgroundMessage(RemoteMessage message) async {
  await Firebase.initializeApp();
}

abstract final class PushNotifications {
  static bool _ready = false;
  static StreamSubscription<String>? _tokenSubscription;
  static final StreamController<Map<String, dynamic>> _orderEventController =
      StreamController<Map<String, dynamic>>.broadcast();

  static Stream<Map<String, dynamic>> get orderEvents =>
      _orderEventController.stream;

  static Future<void> initialize() async {
    try {
      await Firebase.initializeApp();
      _ready = true;
      FirebaseMessaging.onBackgroundMessage(_firebaseBackgroundMessage);
      await FirebaseMessaging.instance
          .setForegroundNotificationPresentationOptions(
            alert: true,
            badge: true,
            sound: true,
          );
    } catch (error) {
      debugPrint('Push initialization unavailable: $error');
    }
  }

  static StreamSubscription<RemoteMessage>? _messageSubscription;

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
      if (token != null && token.isNotEmpty) {
        debugPrint('FCM Token registered: $token');
        await api.registerFcmToken(token);
      }
      _tokenSubscription ??= FirebaseMessaging.instance.onTokenRefresh.listen(
        (nextToken) => api.registerFcmToken(nextToken).catchError((_) {}),
      );
    } catch (error) {
      debugPrint('Push registration unavailable: $error');
    }
  }

  static void listenForeground(BuildContext context) {
    if (!_ready) return;
    _messageSubscription?.cancel();
    _messageSubscription = FirebaseMessaging.onMessage.listen((message) {
      if (message.data['type'] == 'order') {
        _orderEventController.add(Map<String, dynamic>.from(message.data));
      }
      final notification = message.notification;
      final title = notification?.title ?? message.data['title'];
      final body = notification?.body ?? message.data['body'];
      if (title != null && title.toString().isNotEmpty) {
        if (!context.mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            behavior: SnackBarBehavior.floating,
            margin: const EdgeInsets.all(16),
            backgroundColor: const Color(0xFF3B2117),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(16),
            ),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const Icon(
                      Icons.notifications_active,
                      color: Color(0xFFFDE5C2),
                      size: 20,
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        title.toString(),
                        style: const TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.bold,
                          fontSize: 14,
                        ),
                      ),
                    ),
                  ],
                ),
                if (body != null && body.toString().isNotEmpty) ...[
                  const SizedBox(height: 4),
                  Text(
                    body.toString(),
                    style: const TextStyle(
                      color: Color(0xFFFDE5C2),
                      fontSize: 13,
                    ),
                  ),
                ],
              ],
            ),
            duration: const Duration(seconds: 4),
          ),
        );
      }
    });
  }

  static Future<void> unregister(BulkaApiClient api) async {
    if (!_ready) return;
    try {
      await api.clearFcmToken();
    } catch (_) {}
  }
}
