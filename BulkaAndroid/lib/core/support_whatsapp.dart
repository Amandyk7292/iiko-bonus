part of '../main.dart';

const _bulkaSupportWhatsAppPhone = '77011872233';

@visibleForTesting
Uri bulkaSupportWhatsAppUri({int? orderNumber}) {
  final message = orderNumber == null
      ? 'support_whatsapp_message'.tr
      : 'order_support_whatsapp_message'.trArgs({
          'number': orderNumber.toString(),
        });
  return Uri.https('wa.me', '/$_bulkaSupportWhatsAppPhone', {'text': message});
}

Future<void> openBulkaSupportWhatsApp(
  BuildContext context, {
  int? orderNumber,
}) async {
  var opened = false;
  try {
    opened = await launchUrl(
      bulkaSupportWhatsAppUri(orderNumber: orderNumber),
      mode: LaunchMode.externalApplication,
      webOnlyWindowName: kIsWeb ? '_blank' : null,
    );
  } catch (_) {
    opened = false;
  }
  if (!opened && context.mounted) {
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(bulkaSnackBar(content: Text('error_open_whatsapp'.tr)));
  }
}
