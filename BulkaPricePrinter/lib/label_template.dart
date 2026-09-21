class LabelField {
  const LabelField({
    required this.x,
    required this.y,
    required this.width,
    required this.height,
    required this.fontSize,
    required this.weight,
    required this.lineHeight,
    required this.align,
    required this.visible,
    this.breakLanguages = false,
  });
  final double x, y, width, height, fontSize, lineHeight;
  final int weight;
  final String align;
  final bool visible, breakLanguages;

  factory LabelField.fromJson(Map<String, dynamic> json, LabelField fallback) =>
      LabelField(
        x: _number(json['x'], fallback.x),
        y: _number(json['y'], fallback.y),
        width: _number(json['w'], fallback.width),
        height: _number(json['h'], fallback.height),
        fontSize: _number(json['font'], fallback.fontSize),
        weight: (json['weight'] as num?)?.toInt() ?? fallback.weight,
        lineHeight: _number(json['lineHeight'], fallback.lineHeight),
        align: '${json['align'] ?? fallback.align}',
        visible: json['visible'] as bool? ?? fallback.visible,
        breakLanguages:
            json['breakLanguages'] as bool? ?? fallback.breakLanguages,
      );
}

class LabelTemplate {
  const LabelTemplate({
    required this.width,
    required this.height,
    required this.radius,
    required this.background,
    required this.foreground,
    required this.offsetX,
    required this.offsetY,
    required this.fields,
  });
  final double width, height, radius, offsetX, offsetY;
  final String background, foreground;
  final Map<String, LabelField> fields;

  static const defaults = LabelTemplate(
    width: 70,
    height: 50,
    radius: 4,
    background: '#ffffff',
    foreground: '#222222',
    offsetX: 0,
    offsetY: 0,
    fields: {
      'name': LabelField(
        x: 6,
        y: 3,
        width: 58,
        height: 7,
        fontSize: 12,
        weight: 700,
        lineHeight: 1.15,
        align: 'center',
        visible: true,
      ),
      'composition': LabelField(
        x: 7,
        y: 11,
        width: 56,
        height: 12,
        fontSize: 5.3,
        weight: 400,
        lineHeight: 1.15,
        align: 'left',
        visible: true,
      ),
      'barcode': LabelField(
        x: 10,
        y: 24,
        width: 50,
        height: 12,
        fontSize: 5,
        weight: 400,
        lineHeight: 1.15,
        align: 'center',
        visible: true,
      ),
      'dates': LabelField(
        x: 7,
        y: 39,
        width: 38,
        height: 8,
        fontSize: 5.2,
        weight: 400,
        lineHeight: 1.15,
        align: 'left',
        visible: true,
      ),
      'price': LabelField(
        x: 47,
        y: 39,
        width: 17,
        height: 8,
        fontSize: 8,
        weight: 700,
        lineHeight: 1.15,
        align: 'right',
        visible: true,
      ),
    },
  );

  factory LabelTemplate.fromJson(Map<String, dynamic>? json) {
    if (json == null) return defaults;
    final label = json['label'] as Map<String, dynamic>? ?? const {};
    final layout = json['layout'] as Map<String, dynamic>? ?? const {};
    return LabelTemplate(
      width: _number(label['width'], defaults.width),
      height: _number(label['height'], defaults.height),
      radius: _number(label['radius'], defaults.radius),
      background: '${label['background'] ?? defaults.background}',
      foreground: '${label['foreground'] ?? defaults.foreground}',
      offsetX: _number(label['offsetX'], 0),
      offsetY: _number(label['offsetY'], 0),
      fields: {
        for (final entry in defaults.fields.entries)
          entry.key: LabelField.fromJson(
            layout[entry.key] as Map<String, dynamic>? ?? const {},
            entry.value,
          ),
      },
    );
  }
}

double _number(Object? value, double fallback) =>
    value is num ? value.toDouble() : double.tryParse('$value') ?? fallback;
