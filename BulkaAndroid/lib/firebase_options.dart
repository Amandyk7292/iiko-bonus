import 'package:firebase_core/firebase_core.dart';

/// Firebase configuration that cannot be discovered from native plist/json
/// files when the Flutter app runs in a browser.
abstract final class DefaultFirebaseOptions {
  static const FirebaseOptions web = FirebaseOptions(
    apiKey: 'AIzaSyCsw-JRWgGXIaGaT6FaJgA6NOiBfQUE6Oo',
    appId: '1:609090307246:web:e8913be047531501bad93f',
    messagingSenderId: '609090307246',
    projectId: 'bulka-bonus',
    authDomain: 'bulka-bonus.firebaseapp.com',
    storageBucket: 'bulka-bonus.firebasestorage.app',
  );
}
