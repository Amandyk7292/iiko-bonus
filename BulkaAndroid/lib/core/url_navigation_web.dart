import 'package:web/web.dart' as web;

void navigateCurrentWindow(Uri uri) {
  web.window.location.assign(uri.toString());
}

void updateDocumentLanguage(String languageCode) {
  web.document.documentElement?.setAttribute('lang', languageCode);
}

Uri currentClientUri() => Uri.parse(web.window.location.href);

Stream<Uri> clientPopStateUris() {
  return web.window.onPopState.map((_) => currentClientUri());
}

void pushClientUri(Uri uri) {
  web.window.history.pushState(null, '', uri.toString());
}

void replaceClientUri(Uri uri) {
  web.window.history.replaceState(null, '', uri.toString());
}

void popClientHistory() {
  web.window.history.back();
}
