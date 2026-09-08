import 'dart:convert';
import 'dart:typed_data';

const adminFileShareChannel = '_BulkaFileShareNative';
const adminFileShareResponse = 'bulka:file-share-response';
const adminFileShareMaxBytes = 20 * 1024 * 1024;

class AdminSharedFile {
  const AdminSharedFile(this.requestId, this.name, this.mimeType, this.bytes);
  final String requestId;
  final String name;
  final String mimeType;
  final Uint8List bytes;

  static AdminSharedFile? parse(String raw, String nonce) {
    if (nonce.isEmpty || raw.length > adminFileShareMaxBytes * 4 ~/ 3 + 4096) {
      return null;
    }
    try {
      final data = jsonDecode(raw);
      if (data is! Map<String, dynamic> ||
          data['nonce'] != nonce ||
          data['version'] != 1) {
        return null;
      }
      final id = data['requestId'],
          name = data['name'],
          encoded = data['base64'];
      if (id is! String ||
          !RegExp(r'^[a-zA-Z0-9_-]{8,80}$').hasMatch(id) ||
          name is! String ||
          name.isEmpty ||
          name.length > 180 ||
          name.contains(RegExp(r'[/\\\x00-\x1f]')) ||
          encoded is! String) {
        return null;
      }
      final extension = name.split('.').last.toLowerCase();
      final mime = switch (extension) {
        'xlsx' =>
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'csv' => 'text/csv',
        'json' => 'application/json',
        _ => null,
      };
      if (mime == null) return null;
      final bytes = base64Decode(encoded);
      if (bytes.isEmpty || bytes.length > adminFileShareMaxBytes) return null;
      return AdminSharedFile(id, name, mime, bytes);
    } catch (_) {
      return null;
    }
  }
}

String buildAdminFileShareBridge(String nonce) =>
    '''
(() => {
  if (window !== window.top) return;
  const nonce = ${jsonEncode(nonce)};
  window.BulkaFileShare = { shareFile: (file) => new Promise((resolve, reject) => {
    const requestId = 'file_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener('$adminFileShareResponse', response);
    };
    const response = (event) => {
      if (event.detail?.requestId !== requestId) return;
      cleanup();
      if (event.detail.ok) resolve(); else reject(new Error('File sharing unavailable'));
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error('File sharing timeout')); }, 180000);
    window.addEventListener('$adminFileShareResponse', response);
    try {
      window.$adminFileShareChannel.postMessage(JSON.stringify({
        version: 1, nonce, requestId, name: file.name, base64: file.base64
      }));
    } catch (error) { cleanup(); reject(error); }
  }) };
})();
''';
