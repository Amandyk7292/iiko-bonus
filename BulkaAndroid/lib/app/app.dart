part of '../main.dart';

@visibleForTesting
Future<void> reconcileReturnedForteCheckout({
  required BulkaApiClient api,
  required CartProvider cart,
  required SharedPreferences prefs,
}) async {
  await cart.restored;
  final pending = await PendingForteOperationStore.load(api);
  if (pending != null) {
    try {
      final result = await api.checkFortePaymentStatus(pending.operationId);
      final status = _asString(
        result['paymentStatus'] ?? result['status'],
        fallback: 'pending',
      ).toLowerCase();
      if (status == 'paid') {
        await PendingForteOperationStore.clear(api);
        await cart.clearAndWait();
      } else if (isTerminalForteFailure(status)) {
        await PendingForteOperationStore.clear(api);
      }
    } catch (_) {
      // Keep the pending operation and cart. Reconciliation continues from the
      // orders screen without creating another checkout.
    }
  }
  await prefs.setString('lastAppScreen', 'customer-orders');
}

class BulkaBonusApp extends StatefulWidget {
  const BulkaBonusApp({super.key, this.appReleaseChecksEnabled = true});

  final bool appReleaseChecksEnabled;

  @override
  State<BulkaBonusApp> createState() => _BulkaBonusAppState();
}

class _BulkaBonusAppState extends State<BulkaBonusApp>
    with WidgetsBindingObserver {
  static final _minimumSplashDuration = kIsWeb
      ? Duration.zero
      : Durations.extralong1;

  final _api = BulkaApiClient();
  final _appLinks = AppLinks();
  final GlobalKey<NavigatorState> _navigatorKey = GlobalKey<NavigatorState>();
  SharedPreferences? _prefs;
  Timer? _refreshTimer;
  StreamSubscription<Map<String, dynamic>>? _pushOpenSubscription;
  StreamSubscription<Map<String, dynamic>>? _customerEventSubscription;
  StreamSubscription<Uri>? _appLinkSubscription;
  bool _profileRefreshInFlight = false;
  bool _widgetRefreshInFlight = false;
  bool _loginRouteOpen = false;
  bool _notificationPermissionScheduled = false;
  bool _booting = true;
  String? _savedPhone;
  String? _accessToken;
  String? _refreshToken;
  String? _registrationToken;
  Customer? _customer;
  CustomerOrder? _widgetOrder;
  List<BonusTransaction> _transactions = const [];
  int _lastMainTab = 0;
  bool _ordersCompleted = false;
  bool _restoreOrdersScreen = false;
  bool _ordersRouteOpen = false;
  PaymentReturnNotice? _pendingPaymentReturnNotice;
  NotificationTarget? _pendingPushTarget;
  RequiredAppUpdate? _requiredAppUpdate;
  bool _avatarAssetsPrecached = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _api.setSessionListener(_handleSessionChanged);
    OrderLiveStatus.attach(_api);
    _customerEventSubscription = _api.customerEvents.listen(
      _handleCustomerEvent,
    );
    _pushOpenSubscription = PushNotifications.openedTargets.listen(
      _handlePushPayload,
    );
    final initialPush = PushNotifications.takeInitialOpenedTarget();
    if (initialPush != null) {
      _pendingPushTarget = resolveNotificationPayload(
        initialPush,
        fallbackType: _asString(initialPush['type']),
      );
    }
    _appLinkSubscription = _appLinks.uriLinkStream.listen(_handleIncomingLink);
    _bootstrap();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_avatarAssetsPrecached) return;
    _avatarAssetsPrecached = true;
    // Avatars are small local WebP assets. Warming them once prevents the
    // profile header from briefly showing an empty circle on first open.
    Future.wait(
      customerAvatarOptions.map(
        (option) => precacheImage(
          AssetImage(option.assetPath),
          context,
          onError: (_, _) {},
        ),
      ),
    ).ignore();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _refreshTimer?.cancel();
    _pushOpenSubscription?.cancel();
    _customerEventSubscription?.cancel();
    _appLinkSubscription?.cancel();
    _api.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      unawaited(_refreshRequiredAppUpdate());
    }
    final phone = _savedPhone;
    if (state == AppLifecycleState.resumed && phone != null) {
      unawaited(_refreshProfile(phone));
      unawaited(PushNotifications.register(_api));
      _startProfileRefresh(phone);
    } else if (state != AppLifecycleState.resumed) {
      _refreshTimer?.cancel();
    }
  }

  void _handleCustomerEvent(Map<String, dynamic> event) {
    final type = _asString(event['type']);
    if (type == 'order.created' ||
        type == 'order.updated' ||
        type == 'delivery.updated' ||
        type == 'order.customer_arrived') {
      unawaited(_refreshWidgetOrder());
      return;
    }
    if (type != 'loyalty.balance.updated') return;
    final current = _customer;
    final phone = _savedPhone;
    final accessToken = _accessToken;
    if (current == null || phone == null || accessToken == null) return;
    final data = _asMap(event['data']);
    final rawBalance = data['balance'];
    if (rawBalance is! num) {
      unawaited(_refreshProfile(phone));
      return;
    }
    final updated = Customer.fromJson({
      ...current.toJson(),
      'balance': rawBalance,
      if (data['totalSpent'] is num) 'total_spent': data['totalSpent'],
    });
    if (!mounted) return;
    setState(() => _customer = updated);
    unawaited(
      HomeWidgetSync.update(customer: updated, activeOrder: _widgetOrder),
    );
    unawaited(
      _saveSession(phone, updated, _transactions, accessToken, _refreshToken),
    );
    unawaited(_refreshProfile(phone));
  }

  Future<void> _bootstrap() async {
    // Keep the brand transition stable on warm starts without introducing a
    // multi-second artificial wait that feels like startup lag.
    final cart = context.read<CartProvider>();
    final minimumSplashDelay = Future<void>.delayed(_minimumSplashDuration);
    final requiredUpdateFuture = widget.appReleaseChecksEnabled
        ? resolveRequiredAppUpdate(_api)
        : Future<RequiredAppUpdate?>.value();
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('app_theme_mode');
    await SessionStore.clearLegacyCustomerData(prefs);
    var phone = prefs.getString('phone');
    final tokens = await SessionStore.readAndMigrate(prefs);
    var accessToken = tokens.accessToken;
    var refreshToken = tokens.refreshToken;
    var cachedCustomer = _readCustomer(prefs.getString('customer'));
    var cachedTransactions = _readTransactions(prefs.getString('transactions'));
    var profileHydratedDuringBootstrap = false;
    final savedTab = (prefs.getInt('lastMainTab') ?? 0).clamp(0, 4).toInt();
    final initialUri = currentClientUri();
    final paymentReturnNotice = paymentReturnNoticeFromUri(initialUri);
    final restoreOrdersScreen =
        prefs.getString('lastAppScreen') == 'customer-orders' ||
        initialUri.path == '/orders';
    final ordersCompleted = prefs.getBool('ordersCompleted') ?? false;

    _api.setSession(
      accessToken: accessToken,
      refreshToken: refreshToken,
      cacheScope: phone,
    );
    if (kIsWeb) {
      final previousPhone = phone;
      final previousCustomerPhone = cachedCustomer?.phone;
      if (await _api.restoreSession(force: true)) {
        accessToken = _api.accessToken;
        refreshToken = null;
        final restoredPhone = _api.sessionPhone;
        final identityChanged =
            restoredPhone != null &&
            ((previousPhone != null &&
                    !_sameSessionPhone(previousPhone, restoredPhone)) ||
                (previousCustomerPhone != null &&
                    !_sameSessionPhone(previousCustomerPhone, restoredPhone)));
        if (identityChanged) {
          cachedCustomer = null;
          cachedTransactions = const [];
          await SessionStore.clearCustomerData(prefs);
          await HomeWidgetSync.clear();
          await OrderLiveStatus.clear(order: _widgetOrder);
        }
        phone = restoredPhone;
        _api.setSession(accessToken: accessToken, cacheScope: phone);
        if (phone != null && accessToken != null) {
          await prefs.setString('phone', phone);
          await SessionStore.write(accessToken, null);
          try {
            final restoredProfile = await _api.getProfileWithoutRefresh(phone);
            final restoredCustomer = restoredProfile.customer;
            if (restoredProfile.exists &&
                restoredCustomer != null &&
                _sameSessionPhone(restoredCustomer.phone, phone)) {
              cachedCustomer = await _withLatestLoyalty(restoredCustomer);
              cachedTransactions = restoredProfile.transactions;
              await _saveSession(
                phone,
                cachedCustomer,
                cachedTransactions,
                accessToken,
                null,
              );
              profileHydratedDuringBootstrap = true;
            }
          } catch (_) {
            // Never restore another account's cached profile. A verified
            // session can retry hydration on the normal startup refresh.
            if (identityChanged) {
              cachedCustomer = null;
              cachedTransactions = const [];
            }
          }
        }
      } else if (!_api.isAuthenticated) {
        phone = null;
        accessToken = null;
        refreshToken = null;
        cachedCustomer = null;
        cachedTransactions = const [];
        await SessionStore.clearCustomerData(prefs);
        await SessionStore.clear();
      }
    }
    if (paymentReturnNotice != null &&
        prefs.getString('lastAppScreen') == 'checkout' &&
        accessToken != null) {
      await reconcileReturnedForteCheckout(api: _api, cart: cart, prefs: prefs);
    }

    await minimumSplashDelay;
    if (!mounted) return;
    setState(() {
      _prefs = prefs;
      _savedPhone = accessToken == null ? null : phone;
      _accessToken = accessToken;
      _refreshToken = refreshToken;
      _customer = accessToken == null ? null : cachedCustomer;
      _transactions = accessToken == null ? const [] : cachedTransactions;
      _lastMainTab = savedTab;
      _restoreOrdersScreen = restoreOrdersScreen;
      _ordersCompleted = ordersCompleted;
      _pendingPaymentReturnNotice = paymentReturnNotice;
      _booting = false;
    });
    unawaited(_applyRequiredAppUpdate(requiredUpdateFuture));
    if (paymentReturnNotice != null && kIsWeb) {
      publishClientRoute(Uri(path: '/orders'), replace: true);
    }

    if (phone != null && accessToken != null) {
      _api.trackEvent('app_open');
      unawaited(PushNotifications.register(_api));
      if (!profileHydratedDuringBootstrap) await _refreshProfile(phone);
      unawaited(_refreshWidgetOrder());
      _startProfileRefresh(phone);
      if (_restoreOrdersScreen && _savedPhone != null) {
        WidgetsBinding.instance.addPostFrameCallback(
          (_) => unawaited(_openCustomerOrders()),
        );
      }
      if (_pendingPushTarget != null) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) unawaited(_openPendingPushTarget());
        });
      }
    }
  }

  Future<void> _saveMainTab(int tab) async {
    _lastMainTab = tab.clamp(0, 4).toInt();
    final prefs = _prefs ?? await SharedPreferences.getInstance();
    await prefs.setInt('lastMainTab', _lastMainTab);
  }

  Future<void> _refreshRequiredAppUpdate() async {
    await _applyRequiredAppUpdate(resolveRequiredAppUpdate(_api));
  }

  Future<void> _applyRequiredAppUpdate(
    Future<RequiredAppUpdate?> requirementFuture,
  ) async {
    final requirement = await requirementFuture;
    if (!mounted) return;
    final current = _requiredAppUpdate;
    if (current?.targetVersion == requirement?.targetVersion &&
        current?.storeUri == requirement?.storeUri) {
      if (requirement == null) _scheduleFirstLaunchNotificationPermission();
      return;
    }
    setState(() => _requiredAppUpdate = requirement);
    if (requirement == null) _scheduleFirstLaunchNotificationPermission();
  }

  void _scheduleFirstLaunchNotificationPermission() {
    if (kIsWeb ||
        !widget.appReleaseChecksEnabled ||
        _notificationPermissionScheduled) {
      return;
    }
    _notificationPermissionScheduled = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || _requiredAppUpdate != null) return;
      unawaited(PushNotifications.requestPermissionOnFirstLaunch(_api));
    });
  }

  Future<void> _openRequiredUpdateStore() async {
    final requirement = _requiredAppUpdate;
    if (requirement == null) return;
    try {
      final opened = await launchUrl(
        requirement.storeUri,
        mode: LaunchMode.externalApplication,
      );
      if (opened) return;
    } catch (_) {}
    final context = _navigatorKey.currentContext;
    if (context == null || !context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('app_update_store_error'.tr),
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(BulkaRadii.control),
        ),
      ),
    );
  }

  Future<void> _saveOrdersScope(bool completed) async {
    _ordersCompleted = completed;
    final prefs = _prefs ?? await SharedPreferences.getInstance();
    await prefs.setBool('ordersCompleted', completed);
  }

  Future<void> _openCustomerOrders({String? initialOrderId}) async {
    if (_ordersRouteOpen || _savedPhone == null) return;
    final navigator = _navigatorKey.currentState;
    if (navigator == null) return;
    _ordersRouteOpen = true;
    final prefs = _prefs ?? await SharedPreferences.getInstance();
    await prefs.setString('lastAppScreen', 'customer-orders');
    final paymentReturnNotice = _pendingPaymentReturnNotice;
    _pendingPaymentReturnNotice = null;
    try {
      await navigator.push<void>(
        MaterialPageRoute(
          settings: const RouteSettings(name: 'customer-orders'),
          builder: (_) => CustomerOrdersScreen(
            api: _api,
            cacheScope: _savedPhone ?? 'session',
            initialCompleted: _ordersCompleted,
            onScopeChanged: (value) => unawaited(_saveOrdersScope(value)),
            paymentReturnNotice: paymentReturnNotice,
            initialOrderId: initialOrderId,
          ),
        ),
      );
    } finally {
      _ordersRouteOpen = false;
      _restoreOrdersScreen = false;
      await prefs.setString('lastAppScreen', 'main');
      unawaited(_refreshWidgetOrder());
    }
  }

  void _handlePushPayload(Map<String, dynamic> payload) {
    _pendingPushTarget = resolveNotificationPayload(
      payload,
      fallbackType: _asString(payload['type']),
    );
    if (!_booting) unawaited(_openPendingPushTarget());
  }

  Future<void> _openPendingPushTarget() async {
    final target = _pendingPushTarget;
    if (target == null) return;
    final requiresAuth = {
      NotificationTargetKind.order,
      NotificationTargetKind.orders,
      NotificationTargetKind.support,
    }.contains(target.kind);
    if (requiresAuth && _savedPhone == null) return;
    _pendingPushTarget = null;
    switch (target.kind) {
      case NotificationTargetKind.order:
        _restoreOrdersScreen = true;
        await _openCustomerOrders(initialOrderId: target.resourceId);
        return;
      case NotificationTargetKind.orders:
        _restoreOrdersScreen = true;
        await _openCustomerOrders();
        return;
      case NotificationTargetKind.cart:
        publishClientRoute(Uri(path: '/cart'));
        return;
      case NotificationTargetKind.promos:
        publishClientRoute(Uri(path: '/promos'));
        return;
      case NotificationTargetKind.support:
        final navigator = _navigatorKey.currentState;
        if (navigator != null) {
          await navigator.push<void>(
            MaterialPageRoute(
              builder: (_) => OrderSupportScreen(
                api: _api,
                initialRequestId: target.resourceId,
              ),
            ),
          );
        }
        return;
      case NotificationTargetKind.notifications:
        final navigator = _navigatorKey.currentState;
        if (navigator != null) {
          await navigator.push<void>(
            MaterialPageRoute(
              builder: (_) => NotificationsScreen(
                api: _api,
                onRequireAuth: _requireAuthentication,
                onOpenOrders: (orderId) =>
                    _openCustomerOrders(initialOrderId: orderId),
              ),
            ),
          );
        }
        return;
      case NotificationTargetKind.external:
        final uri = target.uri;
        if (uri != null) {
          try {
            await launchUrl(uri, mode: LaunchMode.externalApplication);
          } catch (_) {}
        }
        return;
      case NotificationTargetKind.none:
        return;
    }
  }

  Future<void> _refreshWidgetOrder() async {
    final customer = _customer;
    if (_widgetRefreshInFlight || customer == null || !_api.isAuthenticated) {
      return;
    }
    _widgetRefreshInFlight = true;
    try {
      final orders = await _api.getCustomerOrders();
      final activeOrder = orders.isEmpty ? null : orders.first;
      _widgetOrder = activeOrder;
      await HomeWidgetSync.update(
        customer: _customer ?? customer,
        activeOrder: activeOrder,
      );
      await OrderLiveStatus.sync(activeOrder);
    } catch (_) {
      await HomeWidgetSync.update(
        customer: _customer ?? customer,
        activeOrder: _widgetOrder,
      );
      await OrderLiveStatus.sync(_widgetOrder);
    } finally {
      _widgetRefreshInFlight = false;
    }
  }

  Future<void> _refreshProfile(String phone) async {
    if (_profileRefreshInFlight) return;
    if (!_sameSessionPhone(_savedPhone, phone)) return;
    final requestAccessToken = _api.accessToken;
    if (requestAccessToken == null) return;
    _profileRefreshInFlight = true;
    try {
      final profile = await _api.getProfile(phone);
      if (!mounted) return;
      if (!profile.exists || profile.customer == null) {
        await _logout();
        return;
      }
      if (_api.accessToken != requestAccessToken ||
          !_sameSessionPhone(_savedPhone, phone) ||
          !_sameSessionPhone(profile.customer!.phone, phone)) {
        return;
      }
      final customer = await _withLatestLoyalty(profile.customer!);
      if (_api.accessToken != requestAccessToken ||
          !_sameSessionPhone(_savedPhone, phone)) {
        return;
      }
      final changed = await _saveSession(
        phone,
        customer,
        profile.transactions,
        requestAccessToken,
        _refreshToken,
      );
      if (!changed || !mounted) return;
      setState(() {
        _customer = customer;
        _transactions = profile.transactions;
      });
      unawaited(
        HomeWidgetSync.update(customer: customer, activeOrder: _widgetOrder),
      );
    } catch (error) {
      if (error is ApiException && error.statusCode == 401) await _logout();
    } finally {
      _profileRefreshInFlight = false;
    }
  }

  void _startProfileRefresh(String phone) {
    _refreshTimer?.cancel();
    _refreshTimer = Timer.periodic(
      const Duration(seconds: 30),
      (_) => _refreshProfile(phone),
    );
  }

  Future<String?> _acceptAuthenticatedProfile(
    String phone,
    ProfileResponse profile, {
    String fallbackKey = 'error_login',
  }) async {
    if (!profile.exists || profile.customer == null) return fallbackKey.tr;
    final token = profile.accessToken;
    final refreshToken = profile.refreshToken;
    if (token == null || (!kIsWeb && refreshToken == null)) {
      return 'error_session_missing'.tr;
    }
    _accessToken = token;
    _refreshToken = refreshToken;
    _api.setSession(
      accessToken: token,
      refreshToken: refreshToken,
      cacheScope: phone,
    );
    unawaited(PushNotifications.register(_api));
    final customer = await _withLatestLoyalty(profile.customer!);
    await _saveSession(
      phone,
      customer,
      profile.transactions,
      token,
      refreshToken,
    );
    if (!mounted) return null;
    setState(() {
      _savedPhone = phone;
      _customer = customer;
      _transactions = profile.transactions;
    });
    _startProfileRefresh(phone);
    unawaited(_refreshWidgetOrder());
    return null;
  }

  Future<String?> _loginWithPassword(String phone, String password) async {
    try {
      final profile = await _api.loginWithPassword(
        phone: phone,
        password: password,
      );
      return _acceptAuthenticatedProfile(phone, profile);
    } catch (error) {
      return _userError(error, 'error_login');
    }
  }

  Future<OtpRequestResult> _startPasswordRegistration(
    String phone,
    String password,
    String token,
  ) async {
    try {
      return await _api.startPasswordRegistration(
        phone: phone,
        password: password,
        token: token,
      );
    } catch (error) {
      return OtpRequestResult(error: _userError(error, 'error_register'));
    }
  }

  Future<String?> _verifyPasswordRegistration(String phone, String code) async {
    try {
      final profile = await _api.verifyOtp(phone: phone, code: code);
      if (profile.exists || profile.registrationToken == null) {
        return 'auth_account_exists'.tr;
      }
      _registrationToken = profile.registrationToken;
      return null;
    } catch (error) {
      return _userError(error, 'error_invalid_code');
    }
  }

  Future<OtpRequestResult> _startPasswordReset(
    String phone,
    String token,
  ) async {
    try {
      return await _api.startPasswordReset(phone: phone, token: token);
    } catch (error) {
      return OtpRequestResult(error: _userError(error, 'error_send_code'));
    }
  }

  Future<String?> _completePasswordReset(
    String phone,
    String code,
    String password,
  ) async {
    try {
      final profile = await _api.completePasswordReset(
        phone: phone,
        code: code,
        password: password,
      );
      return _acceptAuthenticatedProfile(phone, profile);
    } catch (error) {
      return _userError(error, 'error_password_reset');
    }
  }

  Future<String?> _registerCustomer({
    required String phone,
    required String name,
    String? surname,
    String? gender,
    String? birthdate,
    String? email,
  }) async {
    try {
      final profile = await _api.registerCustomer(
        phone: phone,
        name: name,
        surname: surname,
        gender: gender,
        birthdate: birthdate,
        email: email,
        registrationToken: _registrationToken ?? '',
      );
      _registrationToken = null;
      return _acceptAuthenticatedProfile(
        phone,
        profile,
        fallbackKey: 'error_register',
      );
    } catch (error) {
      return _userError(error, 'error_register');
    }
  }

  Future<bool> _saveSession(
    String phone,
    Customer customer,
    List<BonusTransaction> transactions,
    String accessToken,
    String? refreshToken,
  ) async {
    final prefs = _prefs ?? await SharedPreferences.getInstance();
    final customerJson = jsonEncode(customer.toJson());
    final transactionsJson = jsonEncode(
      transactions.map((tx) => tx.toJson()).toList(),
    );
    final profileChanged =
        prefs.getString('customer') != customerJson ||
        prefs.getString('transactions') != transactionsJson;

    if (prefs.getString('phone') != phone) {
      await prefs.setString('phone', phone);
    }
    await SessionStore.write(accessToken, refreshToken);
    if (prefs.getString('customer') != customerJson) {
      await prefs.setString('customer', customerJson);
    }
    if (prefs.getString('transactions') != transactionsJson) {
      await prefs.setString('transactions', transactionsJson);
    }
    return profileChanged;
  }

  Future<Customer> _withLatestLoyalty(Customer customer) async {
    if (customer.tier != null && customer.tier!.allTiers.isNotEmpty) {
      return customer;
    }
    try {
      final tier = await _api.getCustomerLoyalty();
      return tier == null ? customer : customer.copyWith(tier: tier);
    } catch (_) {
      return customer;
    }
  }

  Future<void> _logout() async {
    _refreshTimer?.cancel();
    await PushNotifications.unregister(_api);
    await _api.logoutSession();
    await _clearSession();
  }

  Future<bool> _requireAuthentication() async {
    if (_savedPhone != null && _customer != null && _api.isAuthenticated) {
      return true;
    }
    if (_loginRouteOpen) return false;
    final navigator = _navigatorKey.currentState;
    if (navigator == null) return false;
    _loginRouteOpen = true;

    void finishAuthentication() {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        final currentNavigator = _navigatorKey.currentState;
        if (_loginRouteOpen && currentNavigator?.canPop() == true) {
          currentNavigator!.pop(true);
        }
      });
    }

    try {
      final authenticated = await navigator.push<bool>(
        MaterialPageRoute(
          settings: const RouteSettings(name: 'authentication'),
          fullscreenDialog: true,
          builder: (routeContext) => LoginScreen(
            onClose: () => Navigator.of(routeContext).pop(false),
            onLogin: (phone, password) async {
              final result = await _loginWithPassword(phone, password);
              if (result == null) finishAuthentication();
              return result;
            },
            onStartRegistration: _startPasswordRegistration,
            onVerifyRegistration: _verifyPasswordRegistration,
            onStartPasswordReset: _startPasswordReset,
            onResetPassword: (phone, code, password) async {
              final result = await _completePasswordReset(
                phone,
                code,
                password,
              );
              if (result == null) finishAuthentication();
              return result;
            },
            onRegister:
                ({
                  required phone,
                  required name,
                  surname,
                  gender,
                  birthdate,
                  email,
                }) async {
                  final result = await _registerCustomer(
                    phone: phone,
                    name: name,
                    surname: surname,
                    gender: gender,
                    birthdate: birthdate,
                    email: email,
                  );
                  if (result == null) finishAuthentication();
                  return result;
                },
          ),
        ),
      );
      final succeeded =
          authenticated == true &&
          _savedPhone != null &&
          _customer != null &&
          _api.isAuthenticated;
      if (succeeded && _pendingPushTarget != null) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) unawaited(_openPendingPushTarget());
        });
      }
      return succeeded;
    } finally {
      _loginRouteOpen = false;
    }
  }

  void _handleIncomingLink(Uri uri) {
    final isBonus = uri.scheme == 'bulka' && uri.host == 'bonus';
    if (isBonus) {
      _restoreOrdersScreen = false;
      _navigatorKey.currentState?.popUntil((route) => route.isFirst);
      if (mounted) {
        setState(() => _lastMainTab = 0);
      } else {
        _lastMainTab = 0;
      }
      unawaited(_saveMainTab(0));
      return;
    }
    final isOrders =
        uri.path == '/orders' ||
        (uri.scheme == 'bulka' && uri.host == 'orders');
    if (isOrders) {
      _pendingPaymentReturnNotice = paymentReturnNoticeFromUri(uri);
      _restoreOrdersScreen = true;
      if (_savedPhone != null) unawaited(_openCustomerOrders());
      return;
    }

    final clientUri = uri.scheme == 'bulka'
        ? Uri(
            pathSegments: ['', uri.host, ...uri.pathSegments],
            queryParameters: uri.queryParameters.isEmpty
                ? null
                : uri.queryParameters,
          )
        : normalizedClientUri(uri);
    final segments = clientUri.pathSegments
        .where((segment) => segment.isNotEmpty)
        .toList();
    if (segments.isEmpty) return;
    final tab = switch (segments.first) {
      'catalog' => 1,
      'cart' => 2,
      'promos' => 3,
      'profile' => 4,
      _ => null,
    };
    if (tab == null) return;

    _restoreOrdersScreen = false;
    _navigatorKey.currentState?.popUntil((route) => route.isFirst);
    applyExternalClientRoute(clientUri);
    if (mounted) {
      setState(() => _lastMainTab = tab);
    } else {
      _lastMainTab = tab;
    }
    unawaited(_saveMainTab(tab));
  }

  Future<void> _adoptRefreshedWebIdentity(
    String accessToken,
    String? refreshToken,
    String sessionPhone,
  ) async {
    final previousOrder = _widgetOrder;
    _refreshTimer?.cancel();
    _accessToken = accessToken;
    _refreshToken = refreshToken;
    _savedPhone = sessionPhone;
    _customer = null;
    _transactions = const [];
    _widgetOrder = null;
    _api.setSession(
      accessToken: accessToken,
      refreshToken: refreshToken,
      cacheScope: sessionPhone,
    );
    if (mounted) {
      setState(() {});
      _navigatorKey.currentState?.popUntil((route) => route.isFirst);
    }

    final prefs = _prefs ?? await SharedPreferences.getInstance();
    await SessionStore.clearCustomerData(prefs);
    await prefs.setString('phone', sessionPhone);
    await SessionStore.write(accessToken, refreshToken);
    await HomeWidgetSync.clear();
    await OrderLiveStatus.clear(order: previousOrder);

    try {
      final profile = await _api.getProfileWithoutRefresh(sessionPhone);
      final customer = profile.customer;
      if (!profile.exists ||
          customer == null ||
          !_sameSessionPhone(customer.phone, sessionPhone)) {
        throw ApiException(
          'error_session_missing'.tr,
          code: 'SESSION_IDENTITY_MISMATCH',
        );
      }
      if (_api.accessToken != accessToken ||
          !_sameSessionPhone(_api.sessionPhone, sessionPhone)) {
        return;
      }
      await _saveSession(
        sessionPhone,
        customer,
        profile.transactions,
        accessToken,
        refreshToken,
      );
      if (_api.accessToken != accessToken ||
          !_sameSessionPhone(_api.sessionPhone, sessionPhone) ||
          !mounted) {
        return;
      }
      setState(() {
        _customer = customer;
        _transactions = profile.transactions;
      });
      _startProfileRefresh(sessionPhone);
      unawaited(
        HomeWidgetSync.update(customer: customer, activeOrder: _widgetOrder),
      );
      unawaited(_refreshWidgetOrder());
    } catch (_) {
      if (_api.accessToken == accessToken &&
          _sameSessionPhone(_api.sessionPhone, sessionPhone)) {
        await _clearSession();
      }
    }
  }

  Future<void> _handleSessionChanged(
    String? accessToken,
    String? refreshToken,
  ) async {
    if (accessToken == null || (!kIsWeb && refreshToken == null)) {
      await _clearSession();
      return;
    }
    final verifiedPhone = _api.sessionPhone;
    if (kIsWeb && verifiedPhone == null) {
      await _clearSession();
      return;
    }
    if (kIsWeb &&
        !_booting &&
        verifiedPhone != null &&
        _savedPhone != null &&
        !_sameSessionPhone(_savedPhone, verifiedPhone)) {
      await _adoptRefreshedWebIdentity(
        accessToken,
        refreshToken,
        verifiedPhone,
      );
      return;
    }
    _accessToken = accessToken;
    _refreshToken = refreshToken;
    if (verifiedPhone != null) {
      _api.setSession(
        accessToken: accessToken,
        refreshToken: refreshToken,
        cacheScope: verifiedPhone,
      );
    }
    await SessionStore.write(accessToken, refreshToken);
  }

  Future<void> _clearSession() async {
    _refreshTimer?.cancel();
    final prefs = _prefs ?? await SharedPreferences.getInstance();
    await SessionStore.clearCustomerData(prefs);
    await Future.wait([
      prefs.remove('lastAppScreen'),
      prefs.remove('lastMainTab'),
    ]);
    await SessionStore.clear();
    await HomeWidgetSync.clear();
    await OrderLiveStatus.clear(order: _widgetOrder);
    _api.setSession();
    if (!mounted) return;
    setState(() {
      _savedPhone = null;
      _accessToken = null;
      _refreshToken = null;
      _registrationToken = null;
      _customer = null;
      _widgetOrder = null;
      _transactions = const [];
      _lastMainTab = 0;
      _restoreOrdersScreen = false;
    });
    _navigatorKey.currentState?.popUntil((route) => route.isFirst);
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<String>(
      valueListenable: appLanguageNotifier,
      builder: (context, lang, child) {
        return MaterialApp(
          navigatorKey: _navigatorKey,
          debugShowCheckedModeBanner: false,
          title: 'app_title'.tr,
          locale: Locale(lang),
          supportedLocales: const [Locale('ru'), Locale('kk'), Locale('en')],
          localizationsDelegates: const [
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          builder: _buildBulkaAppViewport,
          theme: buildBulkaTheme(),
          themeMode: ThemeMode.light,
          home: _AppStage(child: _buildHome()),
        );
      },
    );
  }

  Widget _buildHome() {
    if (_booting) {
      return SplashScreen(
        key: const ValueKey('app-stage-boot'),
        text: 'splash_loading'.tr,
      );
    }
    final requiredUpdate = _requiredAppUpdate;
    if (requiredUpdate != null) {
      return RequiredAppUpdateScreen(
        key: const ValueKey('app-stage-required-update'),
        requirement: requiredUpdate,
        onUpdate: () => unawaited(_openRequiredUpdateStore()),
      );
    }
    final customer = _customer;
    if (_savedPhone != null && customer == null) {
      return SplashScreen(
        key: const ValueKey('app-stage-profile-loading'),
        text: 'splash_loading_profile'.tr,
      );
    }
    return MainShell(
      key: const ValueKey('app-stage-main'),
      api: _api,
      customer: customer,
      transactions: _transactions,
      onLogout: _logout,
      onRefreshProfile: () async {
        final phone = _savedPhone;
        if (phone != null) await _refreshProfile(phone);
      },
      onRequireAuth: _requireAuthentication,
      initialTab: _lastMainTab,
      onTabChanged: (tab) => unawaited(_saveMainTab(tab)),
      onOpenOrders: _openCustomerOrders,
      onOpenOrder: (orderId) => _openCustomerOrders(initialOrderId: orderId),
    );
  }
}

class _AppStage extends StatelessWidget {
  const _AppStage({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: Theme.of(context).scaffoldBackgroundColor,
      child: BulkaMotionSwitcher(
        duration: BulkaMotion.standard,
        offset: const Offset(0.025, 0),
        scale: 0.995,
        child: child,
      ),
    );
  }
}

class SplashScreen extends StatefulWidget {
  const SplashScreen({required this.text, super.key});

  final String text;

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _scaleAnimation;
  bool _reduceMotion = false;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 4500),
    );

    _scaleAnimation = TweenSequence<double>([
      TweenSequenceItem(
        tween: Tween<double>(
          begin: 0.96,
          end: 1.05,
        ).chain(CurveTween(curve: Curves.easeInOutSine)),
        weight: 50,
      ),
      TweenSequenceItem(
        tween: Tween<double>(
          begin: 1.05,
          end: 0.96,
        ).chain(CurveTween(curve: Curves.easeInOutSine)),
        weight: 50,
      ),
    ]).animate(_controller);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final reduceMotion = BulkaMotion.reduced(context);
    if (reduceMotion == _reduceMotion && _controller.isAnimating) return;
    _reduceMotion = reduceMotion;
    if (_reduceMotion) {
      _controller.stop();
      _controller.value = 0.25;
    } else if (!kIsWeb && !_controller.isAnimating) {
      _controller.repeat();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.sizeOf(context);
    final panelWidth = min(280.0, max(220.0, size.width - 64));
    final logoWidth = min(184.0, panelWidth - 52);
    final logo = Image.asset(
      'assets/brand/bulka_logo.png',
      width: logoWidth,
      fit: BoxFit.contain,
      filterQuality: FilterQuality.high,
      excludeFromSemantics: true,
    );
    return Scaffold(
      backgroundColor: Colors.white,
      body: Semantics(
        container: true,
        liveRegion: true,
        label: widget.text,
        child: SafeArea(
          child: Center(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: RepaintBoundary(
                child: _reduceMotion || kIsWeb
                    ? _SplashLogo(width: panelWidth, child: logo)
                    : ScaleTransition(
                        key: const ValueKey('splash-logo-pulse'),
                        scale: _scaleAnimation,
                        child: _SplashLogo(width: panelWidth, child: logo),
                      ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _SplashLogo extends StatelessWidget {
  const _SplashLogo({required this.width, required this.child});

  final double width;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      key: const ValueKey('splash-clean-logo'),
      width: width,
      child: Center(child: child),
    );
  }
}
