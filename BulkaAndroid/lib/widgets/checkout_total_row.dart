part of '../main.dart';

@visibleForTesting
Widget buildCheckoutTotalRowForTest({
  required String label,
  required String value,
  bool emphasized = false,
}) => _CheckoutTotalRow(label: label, value: value, emphasized: emphasized);

class _CheckoutTotalRow extends StatelessWidget {
  const _CheckoutTotalRow({
    required this.label,
    required this.value,
    this.emphasized = false,
  });

  final String label;
  final String value;
  final bool emphasized;

  @override
  Widget build(BuildContext context) {
    final style = TextStyle(
      fontSize: emphasized ? 18 : 16,
      fontWeight: emphasized ? FontWeight.w700 : FontWeight.w500,
    );
    return LayoutBuilder(
      builder: (context, constraints) {
        double textWidth(String text) {
          final painter = TextPainter(
            text: TextSpan(
              text: text,
              style: DefaultTextStyle.of(context).style.merge(style),
            ),
            textDirection: Directionality.of(context),
            textScaler: MediaQuery.textScalerOf(context),
          )..layout();
          final width = painter.width;
          painter.dispose();
          return width;
        }

        if (textWidth(label) + 12 + textWidth(value) > constraints.maxWidth) {
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(label, style: style),
              const SizedBox(height: 4),
              Text(value, textAlign: TextAlign.end, style: style),
            ],
          );
        }
        return Row(
          children: [
            Expanded(child: Text(label, style: style)),
            const SizedBox(width: 12),
            Text(value, style: style),
          ],
        );
      },
    );
  }
}
