part of '../main.dart';

class StaffTrendChart extends StatefulWidget {
  const StaffTrendChart({
    required this.rows,
    required this.x,
    required this.y,
    super.key,
  });
  final List<Map<String, dynamic>> rows;
  final String x, y;
  @override
  State<StaffTrendChart> createState() => _StaffTrendChartState();
}

class _StaffTrendChartState extends State<StaffTrendChart> {
  int _selected = 0;
  @override
  Widget build(BuildContext context) {
    final rows = widget.rows.where((r) => r[widget.y] is num).toList()
      ..sort((a, b) => '${a[widget.x]}'.compareTo('${b[widget.x]}'));
    if (rows.isEmpty) return const SizedBox.shrink();
    final selected = _selected.clamp(0, rows.length - 1);
    final row = rows[selected];
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              '${staffFieldLabel(widget.y)} · ${row[widget.x]}',
              style: Theme.of(context).textTheme.labelLarge,
            ),
            Text(
              staffValue(row[widget.y]),
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            const SizedBox(height: 14),
            LayoutBuilder(
              builder: (context, box) => GestureDetector(
                onTapDown: (event) => setState(
                  () => _selected =
                      (event.localPosition.dx /
                              box.maxWidth *
                              (rows.length - 1))
                          .round()
                          .clamp(0, rows.length - 1),
                ),
                onHorizontalDragUpdate: (event) => setState(
                  () => _selected =
                      (event.localPosition.dx /
                              box.maxWidth *
                              (rows.length - 1))
                          .round()
                          .clamp(0, rows.length - 1),
                ),
                child: SizedBox(
                  height: 160,
                  width: double.infinity,
                  child: CustomPaint(
                    painter: _StaffTrendPainter(
                      values: rows
                          .map((r) => (r[widget.y] as num).toDouble())
                          .toList(),
                      selected: selected,
                      color: const Color(0xFFBD7F12),
                    ),
                  ),
                ),
              ),
            ),
            if (rows.length > 1)
              Slider(
                value: selected.toDouble(),
                min: 0,
                max: (rows.length - 1).toDouble(),
                divisions: rows.length - 1,
                label: '${row[widget.x]}: ${staffValue(row[widget.y])}',
                semanticFormatterCallback: (v) =>
                    '${rows[v.round()][widget.x]}: ${staffValue(rows[v.round()][widget.y])}',
                onChanged: (v) => setState(() => _selected = v.round()),
              ),
            Wrap(
              alignment: WrapAlignment.spaceBetween,
              children: [
                Text('${rows.first[widget.x]}'),
                Text('${rows.last[widget.x]}'),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _StaffTrendPainter extends CustomPainter {
  const _StaffTrendPainter({
    required this.values,
    required this.selected,
    required this.color,
  });
  final List<double> values;
  final int selected;
  final Color color;
  @override
  void paint(Canvas canvas, Size size) {
    if (values.isEmpty) return;
    final lo = min(0.0, values.reduce(min)),
        hi = max(lo + 1, values.reduce(max));
    final paint = Paint()
      ..color = const Color(0xFFEAE8E2)
      ..strokeWidth = 1;
    for (var i = 0; i < 4; i++) {
      final y = 8 + (size.height - 16) * i / 3;
      canvas.drawLine(Offset(0, y), Offset(size.width, y), paint);
    }
    Offset point(int i) => Offset(
      values.length == 1
          ? size.width / 2
          : i / (values.length - 1) * size.width,
      8 + (hi - values[i]) / (hi - lo) * (size.height - 16),
    );
    final path = Path()..moveTo(point(0).dx, point(0).dy);
    for (var i = 1; i < values.length; i++) {
      path.lineTo(point(i).dx, point(i).dy);
    }
    canvas.drawPath(
      path,
      Paint()
        ..color = color
        ..strokeWidth = 2.5
        ..style = PaintingStyle.stroke
        ..strokeJoin = StrokeJoin.round,
    );
    final chosen = point(selected);
    canvas.drawLine(
      Offset(chosen.dx, 0),
      Offset(chosen.dx, size.height),
      Paint()
        ..color = color.withValues(alpha: .2)
        ..strokeWidth = 1,
    );
    canvas.drawCircle(chosen, 5, Paint()..color = color);
    canvas.drawCircle(chosen, 2, Paint()..color = Colors.white);
  }

  @override
  bool shouldRepaint(_StaffTrendPainter old) =>
      old.selected != selected ||
      !listEquals(old.values, values) ||
      old.color != color;
}
