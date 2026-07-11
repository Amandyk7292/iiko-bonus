import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:geolocator/geolocator.dart';
import 'package:http/http.dart' as http;
import 'package:latlong2/latlong.dart' hide Path;
import 'package:qr_flutter/qr_flutter.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:pinput/pinput.dart';

part 'api/bulka_api_client.dart';
part 'app/app.dart';
part 'core/helpers.dart';
part 'core/localization.dart';
part 'core/motion.dart';
part 'core/push_notifications.dart';
part 'core/theme.dart';
part 'models/models.dart';
part 'repositories/address_repository.dart';
part 'screens/address_details_screen.dart';
part 'screens/address_map_screen.dart';
part 'screens/address_selection_screen.dart';
part 'screens/home_screen.dart';
part 'screens/login_screen.dart';
part 'screens/orders_screen.dart';
part 'screens/notifications_screen.dart';
part 'screens/profile_screen.dart';
part 'screens/personal_data_screen.dart';
part 'screens/locations_screen.dart';
part 'screens/catalog_screen.dart';
part 'shell/main_shell.dart';
part 'widgets/loyalty_panel.dart';
part 'widgets/network_image.dart';
part 'widgets/news.dart';
part 'widgets/qr_dialog.dart';
part 'widgets/stories.dart';
part 'widgets/gradient_button.dart';
part 'widgets/language_bottom_sheet.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await AppLang.init();
  await PushNotifications.initialize();
  runApp(const BulkaBonusApp());
}
