import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';

/// Keeps a page's widget identity until its inputs actually change.
/// Inherited dependencies and the page's own state still update normally.
class StableContent extends StatefulWidget {
  const StableContent({required this.inputs, required this.child, super.key});

  final List<Object?> inputs;
  final Widget child;

  @override
  State<StableContent> createState() => _StableContentState();
}

class _StableContentState extends State<StableContent> {
  late Widget _child;

  @override
  void initState() {
    super.initState();
    _child = widget.child;
  }

  @override
  void didUpdateWidget(covariant StableContent oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!listEquals(oldWidget.inputs, widget.inputs)) _child = widget.child;
  }

  @override
  Widget build(BuildContext context) => _child;
}
