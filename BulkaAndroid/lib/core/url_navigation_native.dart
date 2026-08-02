void navigateCurrentWindow(Uri uri) {
  throw UnsupportedError('Current-window navigation is available only on web.');
}

void updateDocumentLanguage(String languageCode) {}

Uri currentClientUri() => Uri.base;

Stream<Uri> clientPopStateUris() => const Stream<Uri>.empty();

void pushClientUri(Uri uri) {}

void replaceClientUri(Uri uri) {}

void popClientHistory() {}
