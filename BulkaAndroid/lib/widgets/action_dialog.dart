part of '../main.dart';

/// Shared mobile confirmation layout. Actions wrap vertically at their natural
/// height, with matching widths and spacing regardless of translated labels.
class BulkaActionDialog extends StatelessWidget {
  const BulkaActionDialog({
    this.title,
    this.content,
    this.actions = const [],
    this.scrollable = true,
    this.shape,
    super.key,
  });
  final Widget? title;
  final Widget? content;
  final List<Widget> actions;
  final bool scrollable;
  final ShapeBorder? shape;
  @override
  Widget build(BuildContext context) => AlertDialog(
    scrollable: scrollable,
    shape: shape,
    title: title == null
        ? null
        : DefaultTextStyle.merge(textAlign: TextAlign.center, child: title!),
    content: SizedBox(
      width: double.maxFinite,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          ?content,
          if (content != null && actions.isNotEmpty) const SizedBox(height: 24),
          for (var index = 0; index < actions.length; index++) ...[
            if (index > 0) const SizedBox(height: 12),
            DefaultTextStyle.merge(
              textAlign: TextAlign.center,
              child: actions[index],
            ),
          ],
        ],
      ),
    ),
  );
}
