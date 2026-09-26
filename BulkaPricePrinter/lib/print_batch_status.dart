import 'package:flutter/material.dart';
import 'printer_service.dart';

class PrintBatchStatus extends StatelessWidget {
  const PrintBatchStatus({
    super.key,
    required this.batch,
    required this.printing,
    required this.onFinish,
    required this.onResolveUnknown,
  });
  final LabelPrintBatch batch;
  final bool printing;
  final VoidCallback onFinish;
  final void Function(bool printed) onResolveUnknown;

  @override
  Widget build(BuildContext context) => Card(
    child: Padding(
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Отправлено: ${batch.accepted} из ${batch.copies}',
            style: const TextStyle(fontWeight: FontWeight.w700),
          ),
          Text('${batch.product.name} · ${batch.printer.name}'),
          if (printing) ...[
            const SizedBox(height: 8),
            LinearProgressIndicator(value: batch.accepted / batch.copies),
          ],
          if (batch.error != null) Text(batch.error!),
          if (!printing && !batch.complete)
            Wrap(
              spacing: 12,
              children: [
                if (batch.outcomeUnknown) ...[
                  TextButton(
                    onPressed: () => onResolveUnknown(true),
                    child: const Text('Этикетка вышла'),
                  ),
                  TextButton(
                    onPressed: () => onResolveUnknown(false),
                    child: const Text('Этикетка не вышла'),
                  ),
                ],
                TextButton(
                  onPressed: onFinish,
                  child: const Text('Завершить партию'),
                ),
              ],
            ),
        ],
      ),
    ),
  );
}
