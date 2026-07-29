import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/physics.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:home_widget/home_widget.dart';
import 'package:geolocator/geolocator.dart';
import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';
import 'package:image_picker/image_picker.dart';
import 'package:latlong2/latlong.dart' hide Path;
import 'package:qr_flutter/qr_flutter.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:app_links/app_links.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:screen_brightness/screen_brightness.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:pinput/pinput.dart';
import 'package:provider/provider.dart';
import 'package:wakelock_plus/wakelock_plus.dart';

import 'core/cart_provider.dart';
import 'core/http_client_backend.dart';
import 'core/session_storage_backend.dart';
import 'core/url_navigation.dart';
import 'firebase_options.dart';
import 'widgets/forte_checkout_webview.dart';
import 'widgets/yandex_map/yandex_map.dart';
part 'api/bulka_api_client.dart';
part 'app/app.dart';
part 'core/helpers.dart';
part 'core/catalog_search.dart';
part 'core/home_widget_sync.dart';
part 'core/favorite_store.dart';
part 'core/localization.dart';
part 'core/localization_error_helpers.dart';
part 'core/localization_messages_navigation.dart';
part 'core/localization_messages_states.dart';
part 'core/localization_messages_commerce.dart';
part 'core/localization_messages_home.dart';
part 'core/localization_messages_login.dart';
part 'core/localization_messages_common.dart';
part 'core/localization_messages_locations.dart';
part 'core/localization_messages_account.dart';
part 'core/localization_messages_orders.dart';
part 'core/motion.dart';
part 'core/order_live_status.dart';
part 'core/session_store.dart';
part 'core/push_notifications.dart';
part 'core/theme.dart';
part 'models/fulfillment_slot.dart';
part 'models/models.dart';
part 'models/order_models.dart';
part 'repositories/address_repository.dart';
part 'repositories/contact_center_repository.dart';
part 'screens/address_map_screen.dart';
part 'screens/address_selection_screen.dart';
part 'screens/home_screen.dart';
part 'screens/login_screen.dart';
part 'screens/checkout_payment_widgets.dart';
part 'screens/orders_screen.dart';
part 'screens/checkout_screen.dart';
part 'screens/balance_history_screen.dart';
part 'screens/customer_orders_screen.dart';
part 'screens/order_details_screen.dart';
part 'screens/order_support_screen.dart';
part 'screens/notification_settings_screen.dart';
part 'screens/kaspi_payment_screen.dart';
part 'screens/forte_payment_screen.dart';
part 'screens/notifications_screen.dart';
part 'screens/legal_documents_screen.dart';
part 'screens/profile_screen.dart';
part 'screens/payment_methods_screen.dart';
part 'screens/promos_screen.dart';
part 'screens/rewards_screen.dart';
part 'screens/personal_data_screen.dart';
part 'screens/locations_screen.dart';
part 'screens/catalog_screen.dart';
part 'screens/catalog_models.dart';
part 'screens/catalog_widgets.dart';
part 'screens/catalog_filter_screen.dart';
part 'screens/catalog_categories_screen.dart';
part 'screens/product_details_widgets.dart';
part 'screens/product_details_screen.dart';
part 'shell/main_shell.dart';
part 'widgets/loyalty_panel.dart';
part 'widgets/network_image.dart';
part 'widgets/news.dart';
part 'widgets/qr_dialog.dart';
part 'widgets/stories.dart';
part 'widgets/gradient_button.dart';
part 'widgets/language_bottom_sheet.dart';
part 'widgets/bulka_nav_icon.dart';
part 'widgets/desktop_phone_viewport.dart';

Widget _buildBulkaAppViewport(BuildContext _, Widget? child) {
  return BulkaDesktopPhoneViewport(child: child ?? const SizedBox.shrink());
}

@immutable
class BulkaErrorReport {
  const BulkaErrorReport({
    required this.source,
    required this.errorType,
    required this.stackTrace,
  });

  final String source;
  final String errorType;
  final StackTrace stackTrace;
}

typedef BulkaErrorReporter = FutureOr<void> Function(BulkaErrorReport report);

BulkaErrorReporter? _bulkaErrorReporter;

@visibleForTesting
void configureBulkaErrorReporter(BulkaErrorReporter? reporter) {
  _bulkaErrorReporter = reporter;
}

void _reportUnhandledError(
  Object error,
  StackTrace stackTrace, {
  required String source,
}) {
  final report = BulkaErrorReport(
    source: source,
    errorType: error.runtimeType.toString(),
    stackTrace: stackTrace,
  );
  final reporter = _bulkaErrorReporter;
  if (reporter != null) {
    try {
      final result = reporter(report);
      if (result is Future<void>) {
        unawaited(
          result.catchError((Object reporterError, StackTrace reporterStack) {
            debugPrint(
              'Bulka error reporter unavailable: '
              '${reporterError.runtimeType}',
            );
            debugPrintStack(stackTrace: reporterStack);
          }),
        );
      }
      return;
    } catch (reporterError, reporterStack) {
      debugPrint(
        'Bulka error reporter unavailable: ${reporterError.runtimeType}',
      );
      debugPrintStack(stackTrace: reporterStack);
    }
  }
  // Do not print exception messages here: network/provider messages can
  // contain customer data. The error type and stack are enough for the local
  // debug fallback; production reporters receive the same PII-free envelope.
  debugPrint('Unhandled Bulka $source error: ${error.runtimeType}');
  debugPrintStack(stackTrace: stackTrace);
}

void main() {
  runZonedGuarded(
    () {
      WidgetsFlutterBinding.ensureInitialized();
      FlutterError.onError = (details) {
        if (kDebugMode) FlutterError.presentError(details);
        _reportUnhandledError(
          details.exception,
          details.stack ?? StackTrace.current,
          source: 'flutter',
        );
      };
      ui.PlatformDispatcher.instance.onError = (error, stackTrace) {
        _reportUnhandledError(error, stackTrace, source: 'platform');
        return true;
      };
      SystemChrome.setSystemUIOverlayStyle(
        const SystemUiOverlayStyle(
          statusBarColor: Colors.transparent,
          statusBarIconBrightness: Brightness.dark,
          statusBarBrightness: Brightness.light,
          systemNavigationBarColor: _milkyBackground,
          systemNavigationBarIconBrightness: Brightness.dark,
          systemNavigationBarDividerColor: Colors.transparent,
          systemNavigationBarContrastEnforced: false,
        ),
      );
      runApp(
        ChangeNotifierProvider(
          create: (_) => CartProvider(),
          child: const _BulkaBootstrap(),
        ),
      );
    },
    (error, stackTrace) {
      _reportUnhandledError(error, stackTrace, source: 'zone');
    },
  );
}

class _BulkaBootstrap extends StatefulWidget {
  const _BulkaBootstrap();

  @override
  State<_BulkaBootstrap> createState() => _BulkaBootstrapState();
}

class _BulkaBootstrapState extends State<_BulkaBootstrap> {
  late final Future<void> _initialization = _initialize();
  StreamSubscription<Uri>? _browserRouteSubscription;
  Timer? _optionalServicesTimer;

  @override
  void initState() {
    super.initState();
    _browserRouteSubscription = clientPopStateUris().listen(
      applyExternalClientRoute,
    );
  }

  @override
  void dispose() {
    _browserRouteSubscription?.cancel();
    _optionalServicesTimer?.cancel();
    super.dispose();
  }

  Future<void> _initialize() async {
    try {
      await AppLang.init();
    } catch (error) {
      debugPrint('Language initialization unavailable: $error');
    }
    if (kIsWeb) {
      _optionalServicesTimer = Timer(
        const Duration(milliseconds: 900),
        () => unawaited(_initializeOptionalServices()),
      );
    } else {
      unawaited(_initializeOptionalServices());
    }
  }

  Future<void> _initializeOptionalServices() async {
    try {
      await Future.wait([
        PushNotifications.initialize(),
        if (!kIsWeb) HomeWidgetSync.initialize(),
      ]);
    } catch (error) {
      debugPrint('Optional startup service unavailable: $error');
    }
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<void>(
      future: _initialization,
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.done) {
          return const BulkaBonusApp();
        }
        return ValueListenableBuilder<String>(
          valueListenable: appLanguageNotifier,
          builder: (context, lang, child) => MaterialApp(
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
            home: SplashScreen(text: 'splash_loading'.tr),
          ),
        );
      },
    );
  }
}
