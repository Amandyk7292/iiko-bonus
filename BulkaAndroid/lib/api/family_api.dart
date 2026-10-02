part of '../main.dart';

extension FamilyApi on BulkaApiClient {
  Future<ProfileResponse> loginFamilyChild({
    required String login,
    required String password,
  }) async {
    return ProfileResponse.fromJson(
      await _post('/api/auth/family-child/login', {
        'login': login.trim(),
        'password': password,
      }),
    );
  }

  Future<Map<String, dynamic>> getFamily() =>
      _familyResult(_get('/api/customer/family'));

  Future<Map<String, dynamic>> inviteFamily({
    required String phone,
    required String relation,
    required int dailyLimit,
  }) => _familyResult(
    _post('/api/customer/family/invitations', {
      'phone': phone,
      'relation': relation,
      'dailyLimit': dailyLimit,
    }),
  );

  Future<Map<String, dynamic>> answerFamilyInvitation(
    String id, {
    required bool accept,
  }) => _familyResult(
    _post(
      '/api/customer/family/invitations/${Uri.encodeComponent(id)}/answer',
      {'decision': accept ? 'accept' : 'decline'},
    ),
  );

  Future<Map<String, dynamic>> createFamilyChild(Map<String, dynamic> values) =>
      _familyResult(_post('/api/customer/family/children', values));

  Future<Map<String, dynamic>> updateFamilyMember(
    String id,
    Map<String, dynamic> values,
  ) => _familyResult(
    _patch('/api/customer/family/members/${Uri.encodeComponent(id)}', values),
  );

  Future<Map<String, dynamic>> removeFamilyMember(String id) => _familyResult(
    _post('/api/customer/family/members/${Uri.encodeComponent(id)}/remove', {}),
  );

  Future<Map<String, dynamic>> getFamilyQr({required bool payment}) =>
      _familyResult(
        _post(
          isFamilyChildSession
              ? '/api/family-child/qr'
              : '/api/customer/family/qr',
          {'purpose': payment ? 'payment' : 'loyalty'},
        ),
      );

  Future<Map<String, dynamic>> _familyResult(
    Future<Map<String, dynamic>> request,
  ) async {
    final result = await request;
    if (result['success'] != true) {
      throw ApiException(
        _messageFrom(result, 'error_network'.tr),
        code: _nullableString(result['code']),
      );
    }
    return result;
  }
}

String _familyError(Object error) {
  if (error is ApiException) {
    final key = const {
      'FAMILY_UNAVAILABLE': 'unavailable',
      'FAMILY_NOT_FOUND': 'notFound',
      'FAMILY_FORBIDDEN': 'ownerOnly',
      'FAMILY_ALREADY_MEMBER': 'alreadyMember',
      'FAMILY_OWN_FAMILY': 'ownFamily',
      'FAMILY_EXPIRED': 'inviteExpired',
      'FAMILY_CONFLICT': 'loginTaken',
      'FAMILY_SELF': 'inviteSelf',
      'FAMILY_LIMIT': 'limitSpent',
      'FAMILY_BLOCKED': 'accessBlocked',
      'FAMILY_MEMBER_BLOCKED': 'accessBlocked',
      'FAMILY_RECIPIENT_MISSING': 'recipientMissing',
      'FAMILY_BUSY': 'busy',
      'FAMILY_RATE_LIMITED': 'alreadyInvited',
      'FAMILY_PAYMENT_NOT_ALLOWED': 'paymentDisabled',
      'FAMILY_QR_INVALID': 'refreshQr',
      'FAMILY_CHILD_RESTRICTED': 'childHelp',
    }[error.code];
    if (key != null) return _familyText(key);
  }
  return _userError(error, 'error_network');
}
