import 'dart:async';

import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

const _customer = Customer(
  id: 'customer-1',
  name: 'Амандык',
  phone: '77762003590',
  balance: 0,
  totalSpent: 0,
  createdAt: '2026-08-08T00:00:00Z',
  isVip: false,
  cashbackPercent: 0,
  vipThreshold: 0,
  tier: null,
  avatarKey: 'kz_male_01',
);

class _AvatarProfileApi extends BulkaApiClient {
  _AvatarProfileApi({this.pendingSave, this.saveError});

  final Completer<void>? pendingSave;
  final Object? saveError;

  int updateCalls = 0;
  String? savedPhone;
  String? savedAvatarKey;
  String? savedName;
  String? savedLastName;
  String? savedGender;
  String? savedBirthDate;
  String? savedEmail;
  String? savedRegion;

  @override
  Future<List<City>> getCities() async => const [
    City(id: 'aktau', name: 'Актау'),
  ];

  @override
  Future<void> updateProfile({
    required String phone,
    String? name,
    String? lastName,
    String? gender,
    String? birthDate,
    String? email,
    String? region,
    String? avatarKey,
  }) async {
    updateCalls++;
    savedPhone = phone;
    savedAvatarKey = avatarKey;
    savedName = name;
    savedLastName = lastName;
    savedGender = gender;
    savedBirthDate = birthDate;
    savedEmail = email;
    savedRegion = region;
    if (saveError != null) throw saveError!;
    await pendingSave?.future;
  }
}

Future<void> _pumpScreen(
  WidgetTester tester, {
  required _AvatarProfileApi api,
  required CustomerAvatarSavedCallback onAvatarSaved,
  VoidCallback? onBack,
  Future<void> Function()? onProfileUpdated,
  bool asPushedRoute = false,
}) async {
  tester.view.physicalSize = const Size(390, 844);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);

  final personalDataScreen = PersonalDataScreen(
    api: api,
    customer: _customer,
    onBack: onBack ?? () {},
    onLogout: () async {},
    onProfileUpdated: onProfileUpdated ?? () async {},
    onAvatarSaved: onAvatarSaved,
  );
  await tester.pumpWidget(
    asPushedRoute
        ? MaterialApp(
            theme: buildBulkaTheme(),
            initialRoute: '/personal-data',
            routes: {
              '/': (_) => const Scaffold(body: Text('Previous route')),
              '/personal-data': (_) => personalDataScreen,
            },
          )
        : MaterialApp(theme: buildBulkaTheme(), home: personalDataScreen),
  );
  await tester.pumpAndSettle();
}

Future<void> _selectAvatar(WidgetTester tester, String avatarKey) async {
  await tester.tap(find.byKey(const ValueKey('choose-customer-avatar')));
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(ValueKey('avatar-option-$avatarKey')));
  await tester.pump(const Duration(milliseconds: 400));
}

void main() {
  setUp(() => appLanguageNotifier.value = 'ru');

  testWidgets('avatar is saved immediately and blocks duplicate selection', (
    tester,
  ) async {
    final pendingSave = Completer<void>();
    final api = _AvatarProfileApi(pendingSave: pendingSave);
    final propagatedCalls =
        <({String customerId, String phone, String avatarKey})>[];
    await _pumpScreen(
      tester,
      api: api,
      onAvatarSaved:
          ({required customerId, required phone, required avatarKey}) async =>
              propagatedCalls.add((
                customerId: customerId,
                phone: phone,
                avatarKey: avatarKey,
              )),
    );

    const selectedKey = 'kz_female_02';
    await _selectAvatar(tester, selectedKey);

    expect(api.updateCalls, 1);
    expect(api.savedPhone, _customer.phone);
    expect(api.savedAvatarKey, selectedKey);
    expect(api.savedName, isNull);
    expect(api.savedLastName, isNull);
    expect(api.savedGender, isNull);
    expect(api.savedBirthDate, isNull);
    expect(api.savedEmail, isNull);
    expect(api.savedRegion, isNull);
    expect(propagatedCalls, isEmpty);
    expect(
      tester.widget<CustomerAvatar>(find.byType(CustomerAvatar)).avatarKey,
      selectedKey,
    );
    expect(
      find.byKey(const ValueKey('customer-avatar-saving')),
      findsOneWidget,
    );
    expect(find.text('Сохраняем аватар…'), findsOneWidget);
    final savingSemantics = tester.widget<Semantics>(
      find.byKey(const ValueKey('customer-avatar-action-semantics')),
    );
    expect(savingSemantics.properties.label, 'Сохраняем аватар…');
    expect(savingSemantics.properties.enabled, isFalse);
    expect(
      tester
          .widget<InkWell>(find.byKey(const ValueKey('choose-customer-avatar')))
          .onTap,
      isNull,
    );

    await tester.tap(find.byKey(const ValueKey('choose-customer-avatar')));
    await tester.pump();
    expect(api.updateCalls, 1);

    pendingSave.complete();
    await tester.pumpAndSettle();

    expect(propagatedCalls, [
      (
        customerId: _customer.id,
        phone: _customer.phone,
        avatarKey: selectedKey,
      ),
    ]);
    expect(find.byKey(const ValueKey('customer-avatar-saving')), findsNothing);
    expect(find.text('Аватар сохранён.'), findsOneWidget);
    final savedSemantics = tester.widget<Semantics>(
      find.byKey(const ValueKey('customer-avatar-action-semantics')),
    );
    expect(savedSemantics.properties.label, 'Изменить аватар');
    expect(savedSemantics.properties.enabled, isTrue);
    expect(
      tester
          .widget<InkWell>(find.byKey(const ValueKey('choose-customer-avatar')))
          .onTap,
      isNotNull,
    );
  });

  testWidgets('failed avatar save rolls back selection and shows an error', (
    tester,
  ) async {
    final api = _AvatarProfileApi(saveError: StateError('boom'));
    final propagatedCalls =
        <({String customerId, String phone, String avatarKey})>[];
    await _pumpScreen(
      tester,
      api: api,
      onAvatarSaved:
          ({required customerId, required phone, required avatarKey}) async =>
              propagatedCalls.add((
                customerId: customerId,
                phone: phone,
                avatarKey: avatarKey,
              )),
    );

    await _selectAvatar(tester, 'kz_female_03');
    await tester.pumpAndSettle();

    expect(api.updateCalls, 1);
    expect(propagatedCalls, isEmpty);
    expect(
      tester.widget<CustomerAvatar>(find.byType(CustomerAvatar)).avatarKey,
      _customer.avatarKey,
    );
    expect(find.byKey(const ValueKey('customer-avatar-saving')), findsNothing);
    expect(find.text('Не удалось сохранить аватар.'), findsOneWidget);
  });

  testWidgets('propagation failure does not roll back a saved avatar', (
    tester,
  ) async {
    final api = _AvatarProfileApi();
    var refreshCalls = 0;
    await _pumpScreen(
      tester,
      api: api,
      onAvatarSaved:
          ({required customerId, required phone, required avatarKey}) async =>
              throw StateError('local propagation failed'),
      onProfileUpdated: () async => refreshCalls++,
    );

    const selectedKey = 'kz_female_04';
    await _selectAvatar(tester, selectedKey);
    await tester.pumpAndSettle();

    expect(api.updateCalls, 1);
    expect(
      tester.widget<CustomerAvatar>(find.byType(CustomerAvatar)).avatarKey,
      selectedKey,
    );
    expect(refreshCalls, 1);
    expect(find.text('Аватар сохранён.'), findsOneWidget);
    expect(find.text('Не удалось сохранить аватар.'), findsNothing);
  });

  testWidgets('back and destructive actions are blocked while avatar saves', (
    tester,
  ) async {
    final pendingSave = Completer<void>();
    final api = _AvatarProfileApi(pendingSave: pendingSave);
    var backCalls = 0;
    await _pumpScreen(
      tester,
      api: api,
      onAvatarSaved:
          ({required customerId, required phone, required avatarKey}) async {},
      onBack: () => backCalls++,
      asPushedRoute: true,
    );

    await _selectAvatar(tester, 'kz_female_05');

    expect(
      tester
          .widget<PopScope<void>>(
            find.byKey(const ValueKey('personal-data-pop-scope')),
          )
          .canPop,
      isFalse,
    );
    expect(
      tester
          .widget<IconButton>(find.byKey(const ValueKey('personal-data-back')))
          .onPressed,
      isNull,
    );
    expect(
      tester
          .widget<TextButton>(
            find.byKey(const ValueKey('personal-data-delete-account')),
          )
          .onPressed,
      isNull,
    );

    await tester.binding.handlePopRoute();
    await tester.pump();
    expect(find.byType(PersonalDataScreen), findsOneWidget);
    expect(find.text('Previous route'), findsNothing);
    expect(backCalls, 0);

    pendingSave.complete();
    await tester.pumpAndSettle();
    expect(
      tester
          .widget<PopScope<void>>(
            find.byKey(const ValueKey('personal-data-pop-scope')),
          )
          .canPop,
      isTrue,
    );

    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(find.text('Previous route'), findsOneWidget);
  });
}
