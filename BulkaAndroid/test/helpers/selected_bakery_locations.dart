import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

Future<http.Response> selectedBakeryLocationsResponse() async {
  final prefs = await SharedPreferences.getInstance();
  final selected = prefs.getString('selected_bakery_location_id_pickup');
  return http.Response(
    jsonEncode({
      'success': true,
      'locations': [
        for (final id in ['branch-one', 'branch-preview', 'branch-1'])
          {
            'id': id,
            'name': id == selected
                ? prefs.getString('selected_bakery_location_pickup') ?? 'Филиал'
                : 'Филиал',
            'address': '',
            'city': 'Актау',
            'deliveryEnabled': true,
          },
      ],
    }),
    200,
    headers: {'content-type': 'application/json; charset=utf-8'},
  );
}
