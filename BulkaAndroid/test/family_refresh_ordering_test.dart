import 'dart:async';
import 'dart:convert';
import 'package:bulka_bonus/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

http.Response json(Object body, [int status = 200]) => http.Response(
  jsonEncode(body),
  status,
  headers: {'content-type': 'application/json'},
);

Map<String, dynamic> family(bool pending) => {
  'success': true,
  'groupId': null,
  'isOwner': false,
  'sharedBalance': 0,
  'members': [],
  'sentInvitations': [],
  'invitations': pending
      ? [
          {
            'id': 'fixture-invitation',
            'ownerName': 'Fixture invitation owner',
            'relation': 'sister',
            'dailyLimit': 0,
          },
        ]
      : [],
};

void main() {
  for (final staleError in [false, true]) {
    testWidgets(
      'a delayed family ${staleError ? 'error' : 'refresh'} must not undo a completed decline',
      (tester) async {
        appLanguageNotifier.value = 'ru';
        SharedPreferences.setMockInitialValues({});
        final staleRead = Completer<http.Response>();
        var reads = 0;
        var declines = 0;
        final api = BulkaApiClient(
          client: MockClient((request) async {
            if (request.url.path == '/api/customer/family') {
              reads++;
              if (reads == 2) return staleRead.future;
              return json(family(reads == 1));
            }
            if (request.url.path.endsWith('/answer')) {
              expect(jsonDecode(request.body)['decision'], 'decline');
              declines++;
              return json({'success': true});
            }
            throw StateError('Unexpected fixture request: ${request.url}');
          }),
        );
        var profileRefreshes = 0;
        await tester.pumpWidget(
          MaterialApp(
            theme: buildBulkaTheme(),
            home: FamilyScreen(
              api: api,
              onRefreshProfile: () async => profileRefreshes++,
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(find.text('Fixture invitation owner'), findsOneWidget);
        await tester.tap(find.byIcon(Icons.refresh_rounded));
        await tester.pump();
        expect(reads, 2);
        await tester.ensureVisible(find.text('Отклонить'));
        await tester.tap(find.text('Отклонить'));
        await tester.pumpAndSettle();
        expect(declines, 1);
        expect(profileRefreshes, 1);
        expect(reads, 3);
        expect(find.text('Fixture invitation owner'), findsNothing);
        staleRead.complete(
          staleError
              ? json({
                  'success': false,
                  'message': 'Obsolete refresh failed',
                }, 500)
              : json(family(true)),
        );
        await tester.pumpAndSettle();
        final reappeared = find
            .text('Fixture invitation owner')
            .evaluate()
            .isNotEmpty;
        await tester.pumpWidget(const SizedBox());
        api.dispose();
        expect(
          reappeared,
          isFalse,
          reason:
              'A refresh started before decline must not replace the newer family snapshot',
        );
        expect(find.text('Obsolete refresh failed'), findsNothing);
      },
    );
  }
}
