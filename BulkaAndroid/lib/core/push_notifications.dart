part of '../main.dart';

@pragma('vm:entry-point')
Future<void> _firebaseBackgroundMessage(RemoteMessage message) async {
  if (Firebase.apps.isEmpty) await Firebase.initializeApp();
  await HomeWidgetSync.updateFromPush(message.data);
}

abstract final class PushNotifications {
  static const _installationIdKey = 'pushInstallationIdV1';
  static const _lastTokenKey = 'lastRegisteredFcmTokenV1';
  static const _webVapidKey = String.fromEnvironment(
    'FIREBASE_WEB_VAPID_KEY',
    defaultValue:
        'BItWENnHyRNy96PDaiO8Ga76xj3R0bc9ybb1WNNrxNiKuAJHjqOrO9Nqi6mZus4WUlQAYeZnAUyDogjSp46tfhI',
  );
  static bool _ready = false;
  static bool _registering = false;
  static StreamSubscription<String>? _tokenSubscription;
  static final StreamController<Map<String, dynamic>> _orderEventController =
      StreamController<Map<String, dynamic>>.broadcast();
  static final StreamController<Map<String, dynamic>>
  _openedTargetEventController =
      StreamController<Map<String, dynamic>>.broadcast();
  static StreamSubscription<RemoteMessage>? _openedSubscription;
  static Map<String, dynamic>? _pendingOpenedTarget;

  static Stream<Map<String, dynamic>> get orderEvents =>
      _orderEventController.stream;
  static Stream<Map<String, dynamic>> get openedTargets =>
      _openedTargetEventController.stream;

  static Map<String, dynamic>? takeInitialOpenedTarget() {
    final value = _pendingOpenedTarget;
    _pendingOpenedTarget = null;
    return value;
  }

  static NotificationTarget _target(Map<String, dynamic> data) =>
      resolveNotificationPayload(data, fallbackType: _asString(data['type']));

  static bool _isActionable(Map<String, dynamic> data) =>
      _target(data).kind != NotificationTargetKind.none;

  static bool _opensOrders(Map<String, dynamic> data) {
    final kind = _target(data).kind;
    return kind == NotificationTargetKind.order ||
        kind == NotificationTargetKind.orders;
  }

  static String get _platform {
    if (kIsWeb) return 'web';
    return switch (defaultTargetPlatform) {
      TargetPlatform.android => 'android',
      TargetPlatform.iOS => 'ios',
      _ => 'unknown',
    };
  }

  static Future<String> _installationId() async {
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getString(_installationIdKey)?.trim();
    if (saved != null && RegExp(r'^[A-Za-z0-9._:-]{8,160}$').hasMatch(saved)) {
      return saved;
    }
    final random = Random.secure();
    final bytes = List<int>.generate(18, (_) => random.nextInt(256));
    final generated = 'push-${base64UrlEncode(bytes).replaceAll('=', '')}';
    await prefs.setString(_installationIdKey, generated);
    return generated;
  }

  static Future<String> installationId() => _installationId();

  static Future<void> _registerToken(
    BulkaApiClient api,
    String token,
    String installationId,
  ) async {
    if (token.trim().isEmpty) return;
    await api.registerFcmToken(
      token,
      platform: _platform,
      installationId: installationId,
    );
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_lastTokenKey, token);
  }

  static Future<void> initialize() async {
    final attempts = kIsWeb ? 6 : 1;
    for (var attempt = 0; attempt < attempts; attempt++) {
      try {
        if (Firebase.apps.isEmpty) {
          await Firebase.initializeApp(
            options: kIsWeb ? DefaultFirebaseOptions.web : null,
          );
        }
        _ready = true;
        if (!kIsWeb) {
          FirebaseMessaging.onBackgroundMessage(_firebaseBackgroundMessage);
          await FirebaseMessaging.instance
              .setForegroundNotificationPresentationOptions(
                alert: true,
                badge: true,
                sound: true,
              );
        }
        _openedSubscription ??= FirebaseMessaging.onMessageOpenedApp.listen(
          _handleOpenedMessage,
        );
        final initial = await FirebaseMessaging.instance.getInitialMessage();
        if (initial != null) _publishOpenedTarget(initial.data);
        return;
      } catch (error) {
        _ready = false;
        if (attempt + 1 >= attempts) {
          debugPrint('Push initialization unavailable: $error');
          return;
        }
        await Future<void>.delayed(Duration(milliseconds: 350 * (attempt + 1)));
      }
    }
  }

  static StreamSubscription<RemoteMessage>? _messageSubscription;

  static void _publishOpenedTarget(Map<String, dynamic> data) {
    if (!_isActionable(data)) return;
    final payload = Map<String, dynamic>.from(data);
    if (_openedTargetEventController.hasListener) {
      _openedTargetEventController.add(payload);
    } else {
      _pendingOpenedTarget = payload;
    }
  }

  @visibleForTesting
  static void publishOpenedTargetForTesting(Map<String, dynamic> data) {
    _publishOpenedTarget(data);
  }

  static void _handleOpenedMessage(RemoteMessage message) {
    _publishOpenedTarget(message.data);
  }

  static Future<void> register(BulkaApiClient api) async {
    if (!_ready || _registering) return;
    _registering = true;
    try {
      final installationId = await _installationId();
      final settings = await FirebaseMessaging.instance.requestPermission(
        alert: true,
        badge: true,
        sound: true,
      );
      if (settings.authorizationStatus == AuthorizationStatus.denied) return;
      _tokenSubscription ??= FirebaseMessaging.instance.onTokenRefresh.listen(
        (nextToken) => unawaited(
          _registerToken(api, nextToken, installationId).catchError((_) {}),
        ),
      );
      if (!kIsWeb && defaultTargetPlatform == TargetPlatform.iOS) {
        String? apnsToken;
        for (var attempt = 0; attempt < 10 && apnsToken == null; attempt++) {
          apnsToken = await FirebaseMessaging.instance.getAPNSToken();
          if (apnsToken == null) {
            await Future<void>.delayed(const Duration(milliseconds: 300));
          }
        }
        if (apnsToken == null) {
          debugPrint('Push registration is waiting for an APNs token.');
          return;
        }
      }
      final token = await FirebaseMessaging.instance.getToken(
        vapidKey: kIsWeb && _webVapidKey.isNotEmpty ? _webVapidKey : null,
        serviceWorkerScriptPath: kIsWeb ? '/firebase-messaging-sw.js' : null,
      );
      if (token != null && token.isNotEmpty) {
        await _registerToken(api, token, installationId);
      }
    } catch (error) {
      debugPrint('Push registration unavailable: $error');
    } finally {
      _registering = false;
    }
  }

  static void listenForeground(BuildContext context) {
    if (!_ready) return;
    _messageSubscription?.cancel();
    _messageSubscription = FirebaseMessaging.onMessage.listen((message) {
      unawaited(HomeWidgetSync.updateFromPush(message.data));
      if (_opensOrders(message.data)) {
        _orderEventController.add(Map<String, dynamic>.from(message.data));
      }
      // iOS already shows the foreground system banner configured above.
      if (!kIsWeb && defaultTargetPlatform == TargetPlatform.iOS) return;
      final notification = message.notification;
      final title = notification?.title ?? message.data['title'];
      final body = notification?.body ?? message.data['body'];
      final actionable = _isActionable(message.data);
      if (title != null && title.toString().isNotEmpty) {
        if (!context.mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            behavior: SnackBarBehavior.floating,
            margin: const EdgeInsets.all(16),
            backgroundColor: const Color(0xFF3B2117),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(BulkaRadii.control),
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
                          fontFamily: _headingFont,
                          color: Colors.white,
                          fontWeight: FontWeight.bold,
                          fontSize: BulkaTypeScale.bodySmall,
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
                      fontSize: BulkaTypeScale.bodySmall,
                    ),
                  ),
                ],
              ],
            ),
            duration: const Duration(seconds: 4),
            action: actionable
                ? SnackBarAction(
                    label: 'notification_open_hint'.tr,
                    textColor: const Color(0xFFFFD36A),
                    onPressed: () => _openedTargetEventController.add(
                      Map<String, dynamic>.from(message.data),
                    ),
                  )
                : null,
          ),
        );
      }
    });
  }

  static Future<void> unregister(BulkaApiClient api) async {
    if (!_ready) return;
    final prefs = await SharedPreferences.getInstance();
    final installationId = await _installationId();
    final lastToken = prefs.getString(_lastTokenKey);
    try {
      await api.clearFcmToken(
        installationId: installationId,
        fcmToken: lastToken,
      );
    } catch (_) {}
    try {
      await FirebaseMessaging.instance.deleteToken();
    } catch (_) {}
    await prefs.remove(_lastTokenKey);
  }
}
