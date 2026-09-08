part of '../main.dart';

/// Apply the same outside-tap behavior to every text field, including sheets.
/// TextFieldTapRegion keeps editing controls (such as password visibility)
/// inside their field, so those taps continue to work without losing focus.
class BulkaInputDismissal extends StatelessWidget {
  const BulkaInputDismissal({required this.child, super.key});

  final Widget child;

  @override
  Widget build(BuildContext context) => Actions(
    actions: <Type, Action<Intent>>{
      EditableTextTapOutsideIntent:
          CallbackAction<EditableTextTapOutsideIntent>(
            onInvoke: (intent) {
              intent.focusNode.unfocus();
              return null;
            },
          ),
    },
    child: child,
  );
}
