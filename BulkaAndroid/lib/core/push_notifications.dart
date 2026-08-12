part of '../main.dart';

@pragma('vm:entry-point')
Future<void> _firebaseBackgroundMessage(RemoteMessage message) async {
  if (Firebase.apps.isEmpty) await Firebase.initializeApp();
  if (!await PushNotifications.claimMessage(message.data)) return;
  await HomeWidgetSync.updateFromPush(message.data);
}

class _PendingCustomerPushUnregister {
  const _PendingCustomerPushUnregister({
    required this.customerIdentity,
    required this.installationId,
  });

  final String customerIdentity;
  final String installationId;

  static _PendingCustomerPushUnregister? tryParse(Object? value) {
    if (value is! Map) return null;
    final identity = _asString(value['customerIdentity']).trim();
    final installationId = _asString(value['installationId']).trim();
    if (!RegExp(r'^\d{6,20}$').hasMatch(identity) ||
        !RegExp(r'^[A-Za-z0-9._:-]{8,160}$').hasMatch(installationId)) {
      return null;
    }
    return _PendingCustomerPushUnregister(
      customerIdentity: identity,
      installationId: installationId,
    );
  }

  Map<String, String> toJson() => {
    'customerIdentity': customerIdentity,
    'installationId': installationId,
  };

  bool matches(_PendingCustomerPushUnregister other) =>
      customerIdentity == other.customerIdentity &&
      installationId == other.installationId;
}

abstract final class PushNotifications {
  static const _installationIdKey = 'pushInstallationIdV1';
  static const _lastTokenKey = 'lastRegisteredFcmTokenV1';
  static const _seenPushIdsKey = 'seenPushOutboxIdsV1';
  static const _pendingCustomerUnregistersKey =
      'pendingCustomerPushUnregistersV1';
  static const _pendingInstallationTokenDeletionKey =
      'pendingFirebaseTokenDeletionV1';
  static const _pendingStaffTokenRebindKey = 'pendingStaffPushTokenRebindV1';
  static const _permissionPromptedKey = 'pushPermissionPromptedV1';
  static final Set<String> _seenPushIds = <String>{};
  static const _webVapidKey = String.fromEnvironment(
    'FIREBASE_WEB_VAPID_KEY',
    defaultValue:
        'BItWENnHyRNy96PDaiO8Ga76xj3R0bc9ybb1WNNrxNiKuAJHjqOrO9Nqi6mZus4WUlQAYeZnAUyDogjSp46tfhI',
  );
  static bool _ready = false;
  static bool _registering = false;
  static int _customerPushGeneration = 0;
  static Future<void> _customerPushMutationTail = Future<void>.value();
  static Future<void>? _initializationTask;
  static StreamSubscription<String>? _tokenSubscription;
  static StreamSubscription<String>? _staffTokenSubscription;
  static bool _staffBridgeActivated = false;
  @visibleForTesting
  static Future<void> Function()? deleteInstallationTokenForTesting;
  @visibleForTesting
  static Future<String?> Function()? getInstallationTokenForTesting;
  static final StreamController<Map<String, Object?>>
  _staffTokenEventController =
      StreamController<Map<String, Object?>>.broadcast();
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
  static Stream<Map<String, Object?>> get staffTokenEvents =>
      _staffTokenEventController.stream;

  static Future<bool> _staffEnrollmentIntent() =>
      StaffPushEnrollmentStore.read();

  static Future<void> _setStaffEnrollmentIntent(bool enabled) async {
    await StaffPushEnrollmentStore.write(enabled);
    if (!enabled) {
      await (await SharedPreferences.getInstance()).remove(
        _pendingStaffTokenRebindKey,
      );
    }
  }

  /// Called only by the native WebView after it has revalidated the exact,
  /// trusted kitchen URL and the per-page bridge nonce.
  static void setStaffPushBridgeActivated(bool active) {
    _staffBridgeActivated = active;
    if (!active) return;
    unawaited(_restoreActiveStaffEnrollment());
  }

  static Map<String, dynamic>? takeInitialOpenedTarget() {
    final value = _pendingOpenedTarget;
    _pendingOpenedTarget = null;
    return value;
  }

  static NotificationTarget _target(Map<String, dynamic> data) =>
      resolveNotificationPayload(data, fallbackType: _asString(data['type']));

  static String? _stablePushIdentifier(Object? value) {
    final candidate = _asString(value).trim();
    if (candidate.length < 8 || candidate.length > 200) return null;
    return RegExp(r'^[A-Za-z0-9._:-]+$').hasMatch(candidate) ? candidate : null;
  }

  static Future<bool> claimMessage(Map<String, dynamic> data) async {
    try {
      return await PushDedupeLock.synchronized(() async {
        // Reload bypasses the legacy per-isolate cache. The OS file lock makes
        // the read-modify-write claim atomic across Firebase's background
        // isolate and the main Flutter isolate while retaining the existing
        // native SharedPreferences backend.
        final prefs = await SharedPreferences.getInstance();
        await prefs.reload();
        if (prefs.getBool(_pendingInstallationTokenDeletionKey) == true) {
          return false;
        }
        final type = _asString(data['type']).trim().toLowerCase();
        final isStaffOrder =
            type == 'staff.order.new' || type == 'staff.order.test';
        final ids = <String>{
          ?_stablePushIdentifier(data['pushOutboxId']),
          if (isStaffOrder) ?_stablePushIdentifier(data['pushDedupeKey']),
        };
        if (ids.isEmpty) return true;
        final seenInMemory = ids.any(_seenPushIds.contains);
        final persisted =
            prefs.getStringList(_seenPushIdsKey) ?? const <String>[];
        final isDuplicate = seenInMemory || ids.any(persisted.contains);
        _seenPushIds.addAll(ids);
        final next = <String>[
          ...persisted.where((value) => !ids.contains(value)),
          ...ids,
        ];
        if (next.length > 100) next.removeRange(0, next.length - 100);
        await prefs.setStringList(_seenPushIdsKey, next);
        return !isDuplicate;
      });
    } catch (error) {
      // A claim that cannot be serialized is unsafe to process: Firebase may
      // redeliver it later, while processing now could create two UI actions.
      debugPrint('Push claim unavailable: ${error.runtimeType}');
      return false;
    }
  }

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

  static Future<void> _queueCustomerPushMutation(
    Future<void> Function() mutation,
  ) {
    final next = _customerPushMutationTail.then((_) => mutation());
    _customerPushMutationTail = next.catchError((Object _) {});
    return next;
  }

  static List<_PendingCustomerPushUnregister> _readPendingUnregisters(
    SharedPreferences prefs,
  ) {
    final raw = prefs.getString(_pendingCustomerUnregistersKey);
    if (raw == null || raw.isEmpty) return const [];
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! List) return const [];
      return decoded
          .map(_PendingCustomerPushUnregister.tryParse)
          .whereType<_PendingCustomerPushUnregister>()
          .toList(growable: false);
    } catch (_) {
      return const [];
    }
  }

  static Future<void> _writePendingUnregisters(
    SharedPreferences prefs,
    List<_PendingCustomerPushUnregister> pending,
  ) async {
    if (pending.isEmpty) {
      await prefs.remove(_pendingCustomerUnregistersKey);
      return;
    }
    await prefs.setString(
      _pendingCustomerUnregistersKey,
      jsonEncode(pending.map((value) => value.toJson()).toList()),
    );
  }

  static Future<void> _rememberPendingUnregister(
    SharedPreferences prefs,
    _PendingCustomerPushUnregister marker,
  ) async {
    final next =
        _readPendingUnregisters(
            prefs,
          ).where((value) => !value.matches(marker)).toList(growable: true)
          ..add(marker);
    if (next.length > 8) next.removeRange(0, next.length - 8);
    await _writePendingUnregisters(prefs, next);
  }

  static Future<void> _forgetPendingUnregister(
    SharedPreferences prefs,
    _PendingCustomerPushUnregister marker,
  ) => _writePendingUnregisters(
    prefs,
    _readPendingUnregisters(
      prefs,
    ).where((value) => !value.matches(marker)).toList(growable: false),
  );

  static String? _customerIdentity(BulkaApiClient api, [String? fallback]) =>
      _canonicalSessionPhone(fallback) ??
      _canonicalSessionPhone(api.sessionPhone) ??
      _canonicalSessionPhone(api.sessionCacheScope);

  /// Retries customer-only unlink work after the same customer authenticates
  /// again. A marker from another account is never submitted with the current
  /// account's credentials.
  static Future<bool> retryPendingCustomerUnregister(BulkaApiClient api) async {
    if (!api.isAuthenticated) return false;
    final identity = _customerIdentity(api);
    if (identity == null) return false;
    final prefs = await SharedPreferences.getInstance();
    final matching = _readPendingUnregisters(
      prefs,
    ).where((value) => value.customerIdentity == identity).toList();
    var cleared = true;
    for (final marker in matching) {
      try {
        await _queueCustomerPushMutation(
          () => api.clearFcmToken(installationId: marker.installationId),
        );
        await _forgetPendingUnregister(prefs, marker);
        if (prefs.getString(_installationIdKey) == marker.installationId) {
          await prefs.remove(_lastTokenKey);
        }
      } catch (_) {
        cleared = false;
      }
    }
    return cleared;
  }

  static Future<void> _registerToken(
    BulkaApiClient api,
    String token,
    String installationId,
    int generation,
  ) async {
    if (token.trim().isEmpty || generation != _customerPushGeneration) return;
    await _queueCustomerPushMutation(() async {
      if (generation != _customerPushGeneration) return;
      await api.registerFcmToken(
        token,
        platform: _platform,
        installationId: installationId,
      );
      if (generation != _customerPushGeneration) return;
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_lastTokenKey, token);
    });
  }

  static Future<void> initialize() {
    final running = _initializationTask;
    if (running != null) return running;
    late final Future<void> task;
    final initialization = _ready
        ? _retryPendingInstallationTokenDeletion().then((_) {})
        : _initializeFirebase();
    task = initialization.whenComplete(() {
      if (identical(_initializationTask, task)) _initializationTask = null;
    });
    _initializationTask = task;
    return task;
  }

  static Future<void> _initializeFirebase() async {
    // Tests use the same preflight seam to prove restart recovery without
    // depending on a platform Firebase implementation.
    if (deleteInstallationTokenForTesting != null) {
      final hadPending =
          (await SharedPreferences.getInstance()).getBool(
            _pendingInstallationTokenDeletionKey,
          ) ==
          true;
      await _retryPendingInstallationTokenDeletion();
      if (hadPending) return;
    }
    final attempts = kIsWeb ? 6 : 1;
    for (var attempt = 0; attempt < attempts; attempt++) {
      try {
        if (Firebase.apps.isEmpty) {
          await Firebase.initializeApp(
            options: kIsWeb ? DefaultFirebaseOptions.web : null,
          );
        }
        _ready = true;
        await _retryPendingInstallationTokenDeletion();
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

  static String _permissionName(AuthorizationStatus status) => switch (status) {
    AuthorizationStatus.authorized => 'authorized',
    AuthorizationStatus.provisional => 'provisional',
    AuthorizationStatus.denied => 'denied',
    AuthorizationStatus.notDetermined => 'notDetermined',
  };

  static bool _permissionAllowsPush(AuthorizationStatus status) {
    return status == AuthorizationStatus.authorized ||
        status == AuthorizationStatus.provisional;
  }

  static Future<bool> _waitForApnsToken() async {
    if (defaultTargetPlatform != TargetPlatform.iOS) return true;
    for (var attempt = 0; attempt < 16; attempt++) {
      if ((await FirebaseMessaging.instance.getAPNSToken())?.isNotEmpty ==
          true) {
        return true;
      }
      await Future<void>.delayed(const Duration(milliseconds: 300));
    }
    return false;
  }

  static void _listenForStaffTokenRefresh() {
    _staffTokenSubscription ??= FirebaseMessaging.instance.onTokenRefresh
        .listen(_handleStaffTokenRefresh);
  }

  static Future<void> _handleStaffTokenRefresh(String token) async {
    if (token.trim().isEmpty || !await _staffEnrollmentIntent()) return;
    if (!_staffBridgeActivated) {
      await (await SharedPreferences.getInstance()).setBool(
        _pendingStaffTokenRebindKey,
        true,
      );
      return;
    }
    final installationId = await _installationId();
    if (!_staffBridgeActivated || !await _staffEnrollmentIntent()) return;
    _staffTokenEventController.add({
      'version': staffPushBridgeVersion,
      'platform': _platform,
      'installationId': installationId,
      'fcmToken': token,
    });
  }

  @visibleForTesting
  static Future<void> handleStaffTokenRefreshForTesting(String token) =>
      _handleStaffTokenRefresh(token);

  /// Returns native credentials to the authenticated staff portal. The portal
  /// binds them to its own staff session and branch; this deliberately never
  /// calls the customer push endpoint.
  static Future<Map<String, Object?>> handleStaffPushBridgeRequest(
    StaffPushBridgeRequest request,
  ) async {
    final installationId = await _installationId();
    var staffEnrollmentIntent = await _staffEnrollmentIntent();
    final identity = <String, Object?>{
      'platform': _platform,
      'installationId': installationId,
      'permission': 'unknown',
      'staffEnrollmentIntent': staffEnrollmentIntent,
    };
    if (kIsWeb ||
        !const {
          TargetPlatform.android,
          TargetPlatform.iOS,
        }.contains(defaultTargetPlatform)) {
      return {...identity, 'ok': false, 'error': 'unsupported_platform'};
    }
    if (request.action == StaffPushBridgeAction.status) {
      if (!_ready) await initialize();
      if (!_ready) {
        return {...identity, 'ok': false, 'error': 'firebase_unavailable'};
      }
      if (!await _retryPendingInstallationTokenDeletion()) {
        return {...identity, 'ok': false, 'error': 'native_unavailable'};
      }
      try {
        final settings = await FirebaseMessaging.instance
            .getNotificationSettings();
        return {
          ...identity,
          'ok': true,
          'permission': _permissionName(settings.authorizationStatus),
        };
      } catch (_) {
        return {...identity, 'ok': false, 'error': 'native_unavailable'};
      }
    }
    if (request.action == StaffPushBridgeAction.unregister) {
      // The same Firebase installation may still receive customer order and
      // loyalty notifications. The staff backend revokes only its binding.
      await _setStaffEnrollmentIntent(false);
      staffEnrollmentIntent = false;
      return {
        ...identity,
        'staffEnrollmentIntent': staffEnrollmentIntent,
        'ok': true,
      };
    }
    if (!_ready) await initialize();
    if (!_ready) {
      return {...identity, 'ok': false, 'error': 'firebase_unavailable'};
    }
    if (!await _retryPendingInstallationTokenDeletion()) {
      return {...identity, 'ok': false, 'error': 'native_unavailable'};
    }
    try {
      var settings = await FirebaseMessaging.instance.getNotificationSettings();
      if (settings.authorizationStatus == AuthorizationStatus.notDetermined) {
        if (!request.userInitiated) {
          return {
            ...identity,
            'ok': false,
            'permission': 'notDetermined',
            'error': 'permission_required',
          };
        }
        settings = await FirebaseMessaging.instance.requestPermission(
          alert: true,
          badge: true,
          sound: true,
        );
      }
      final permission = _permissionName(settings.authorizationStatus);
      if (!_permissionAllowsPush(settings.authorizationStatus)) {
        return {
          ...identity,
          'ok': false,
          'permission': permission,
          'error': 'permission_denied',
        };
      }
      if (!await _waitForApnsToken()) {
        return {
          ...identity,
          'ok': false,
          'permission': permission,
          'error': 'apns_unavailable',
        };
      }
      final token = await FirebaseMessaging.instance.getToken();
      if (token == null || token.trim().isEmpty) {
        return {
          ...identity,
          'ok': false,
          'permission': permission,
          'error': 'token_unavailable',
        };
      }
      await _setStaffEnrollmentIntent(true);
      await (await SharedPreferences.getInstance()).remove(
        _pendingStaffTokenRebindKey,
      );
      staffEnrollmentIntent = true;
      _listenForStaffTokenRefresh();
      return {
        ...identity,
        'staffEnrollmentIntent': staffEnrollmentIntent,
        'ok': true,
        'permission': permission,
        'fcmToken': token,
      };
    } catch (_) {
      return {...identity, 'ok': false, 'error': 'native_unavailable'};
    }
  }

  static Future<void> requestPermissionOnFirstLaunch(BulkaApiClient api) async {
    if (kIsWeb) return;
    final prefs = await SharedPreferences.getInstance();
    if (prefs.getBool(_permissionPromptedKey) == true) return;
    if (!_ready) await initialize();
    if (!_ready) return;
    try {
      final current = await FirebaseMessaging.instance
          .getNotificationSettings();
      final shouldRequest =
          defaultTargetPlatform == TargetPlatform.android ||
          current.authorizationStatus == AuthorizationStatus.notDetermined;
      final settings = shouldRequest
          ? await FirebaseMessaging.instance.requestPermission(
              alert: true,
              badge: true,
              sound: true,
            )
          : current;
      await prefs.setBool(_permissionPromptedKey, true);
      if (api.isAuthenticated &&
          (settings.authorizationStatus == AuthorizationStatus.authorized ||
              settings.authorizationStatus ==
                  AuthorizationStatus.provisional)) {
        await register(api);
      }
    } catch (error) {
      debugPrint('Notification permission prompt unavailable: $error');
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
    final generation = _customerPushGeneration;
    if (!api.isAuthenticated ||
        !await _retryPendingInstallationTokenDeletion() ||
        !await retryPendingCustomerUnregister(api) ||
        generation != _customerPushGeneration ||
        !_ready ||
        _registering) {
      return;
    }
    _registering = true;
    try {
      final installationId = await _installationId();
      final settings = kIsWeb
          ? await FirebaseMessaging.instance.requestPermission(
              alert: true,
              badge: true,
              sound: true,
            )
          : await FirebaseMessaging.instance.getNotificationSettings();
      if (settings.authorizationStatus != AuthorizationStatus.authorized &&
          settings.authorizationStatus != AuthorizationStatus.provisional) {
        return;
      }
      _tokenSubscription ??= FirebaseMessaging.instance.onTokenRefresh.listen((
        nextToken,
      ) {
        unawaited(
          _registerToken(
            api,
            nextToken,
            installationId,
            generation,
          ).catchError((_) {}),
        );
      });
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
        await _registerToken(api, token, installationId, generation);
      }
    } catch (error) {
      debugPrint('Push registration unavailable: $error');
    } finally {
      _registering = false;
    }
  }

  static Future<void> listenForeground(BuildContext context) async {
    if (!_ready) await initialize();
    if (!_ready || !context.mounted) return;
    _messageSubscription?.cancel();
    _messageSubscription = FirebaseMessaging.onMessage.listen((message) async {
      if (!await claimMessage(message.data)) return;
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

  /// Stops customer token refresh and durably records the unlink intent
  /// without requiring a working customer session. Forced 401 cleanup uses
  /// this path so an invalid local session cannot block the UI indefinitely.
  static Future<void> deferCustomerUnregister(
    BulkaApiClient api, {
    String? customerIdentity,
    bool invalidateInstallationToken = false,
  }) async {
    _customerPushGeneration++;
    final prefs = await SharedPreferences.getInstance();
    final installationId = await _installationId();
    final identity = _customerIdentity(api, customerIdentity);
    final marker = identity == null
        ? null
        : _PendingCustomerPushUnregister(
            customerIdentity: identity,
            installationId: installationId,
          );
    if (marker != null) await _rememberPendingUnregister(prefs, marker);
    final tokenSubscription = _tokenSubscription;
    _tokenSubscription = null;
    await tokenSubscription?.cancel();
    if (!invalidateInstallationToken) return;

    final staffTokenSubscription = _staffTokenSubscription;
    _staffTokenSubscription = null;
    await staffTokenSubscription?.cancel();
    if (await _staffEnrollmentIntent()) {
      await prefs.setBool(_pendingStaffTokenRebindKey, true);
    }
    await prefs.setBool(_pendingInstallationTokenDeletionKey, true);
    await _retryPendingInstallationTokenDeletion();
  }

  static Future<void> _restoreActiveStaffEnrollment() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.reload();
    if (!_staffBridgeActivated ||
        !await _staffEnrollmentIntent() ||
        prefs.getBool(_pendingStaffTokenRebindKey) != true ||
        prefs.getBool(_pendingInstallationTokenDeletionKey) == true) {
      return;
    }
    try {
      String? token;
      final tokenOverride = getInstallationTokenForTesting;
      if (tokenOverride != null) {
        token = await tokenOverride();
      } else {
        if (!_ready) return;
        final settings = await FirebaseMessaging.instance
            .getNotificationSettings();
        if (!_permissionAllowsPush(settings.authorizationStatus) ||
            !await _waitForApnsToken()) {
          return;
        }
        token = await FirebaseMessaging.instance.getToken();
      }
      if (token == null || token.trim().isEmpty) return;
      if (!_staffBridgeActivated ||
          !await _staffEnrollmentIntent() ||
          prefs.getBool(_pendingInstallationTokenDeletionKey) == true) {
        return;
      }
      if (tokenOverride == null) _listenForStaffTokenRefresh();
      final installationId = await _installationId();
      _staffTokenEventController.add({
        'version': staffPushBridgeVersion,
        'platform': _platform,
        'installationId': installationId,
        'fcmToken': token,
      });
      // Keep the marker until a trusted bridge completes an explicit register
      // handshake. Emitting an event cannot prove that the portal's backend
      // upsert succeeded (for example, the iPad may go offline immediately).
    } catch (error) {
      if (getInstallationTokenForTesting == null) {
        debugPrint('Staff push token rebind unavailable: ${error.runtimeType}');
      }
      // Keep the non-secret marker. A later initialize or trusted kitchen
      // bridge activation retries without requiring the cashier to opt in.
    }
  }

  static Future<bool> _retryPendingInstallationTokenDeletion() async {
    final prefs = await SharedPreferences.getInstance();
    if (prefs.getBool(_pendingInstallationTokenDeletionKey) != true) {
      return true;
    }
    try {
      final deleteOverride = deleteInstallationTokenForTesting;
      if (deleteOverride != null) {
        await deleteOverride();
      } else {
        if (!_ready) return false;
        await FirebaseMessaging.instance.deleteToken();
      }
      // Keep the installation id: the staff portal can obtain a fresh FCM
      // token later and rebind the same backend device without leaking the old
      // customer token. The backend unlink marker remains until confirmation.
      await prefs.remove(_lastTokenKey);
      await prefs.remove(_pendingInstallationTokenDeletionKey);
      await _restoreActiveStaffEnrollment();
      return true;
    } catch (error) {
      if (deleteInstallationTokenForTesting == null) {
        debugPrint(
          'Push installation invalidation unavailable: ${error.runtimeType}',
        );
      }
      return false;
    }
  }

  /// Returns false unless removal of the authenticated customer binding was
  /// confirmed. An explicit user logout must remain fail-closed on false; the
  /// durable marker is a recovery fallback, not a successful logout signal.
  static Future<bool> unregister(
    BulkaApiClient api, {
    String? customerIdentity,
  }) async {
    await deferCustomerUnregister(api, customerIdentity: customerIdentity);
    final prefs = await SharedPreferences.getInstance();
    final installationId = await _installationId();
    final lastToken = prefs.getString(_lastTokenKey);
    final identity = _customerIdentity(api, customerIdentity);
    final marker = identity == null
        ? null
        : _PendingCustomerPushUnregister(
            customerIdentity: identity,
            installationId: installationId,
          );
    try {
      await _queueCustomerPushMutation(
        () => api.clearFcmToken(
          installationId: installationId,
          fcmToken: lastToken,
        ),
      );
    } catch (_) {
      // Keep both the durable marker and last known customer token. A later
      // authenticated lifecycle for this same customer retries the unlink.
      return false;
    }
    if (marker != null) await _forgetPendingUnregister(prefs, marker);
    // Do not delete the Firebase installation token here. A staff session on
    // the same device can still own a separate branch-scoped push binding.
    // Clearing the authenticated customer binding above preserves privacy.
    await prefs.remove(_lastTokenKey);
    return true;
  }
}
