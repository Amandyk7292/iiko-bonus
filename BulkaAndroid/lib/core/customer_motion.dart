part of '../main.dart';

class BulkaValueTransition extends StatelessWidget {
  const BulkaValueTransition({
    required this.value,
    required this.child,
    super.key,
  });
  final Object value;
  final Widget child;
  @override
  Widget build(BuildContext context) => BulkaMotionSwitcher(
    duration: const Duration(milliseconds: 160),
    offset: const Offset(0, 0.12),
    scale: 1,
    child: KeyedSubtree(key: ValueKey(value), child: child),
  );
}

class BulkaFavoriteGlyph extends StatelessWidget {
  const BulkaFavoriteGlyph({required this.selected, this.size = 24, super.key});
  final bool selected;
  final double size;
  @override
  Widget build(BuildContext context) => AnimatedScale(
    scale: selected ? 1.1 : 1,
    duration: BulkaMotion.duration(context, const Duration(milliseconds: 180)),
    curve: Curves.easeOutCubic,
    child: BulkaMotionSwitcher(
      duration: const Duration(milliseconds: 160),
      offset: Offset.zero,
      scale: 1,
      child: Icon(
        selected ? Icons.favorite_rounded : Icons.favorite_border_rounded,
        key: ValueKey(selected),
        size: size,
      ),
    ),
  );
}

/// Validate on submit, reveal the first invalid field and give one short cue.
bool validateBulkaForm(GlobalKey<FormState> key) {
  final form = key.currentState;
  if (form == null) return false;
  final invalid = form.validateGranularly();
  if (invalid.isEmpty) return true;
  BulkaMotion.error();
  final field = invalid.first;
  WidgetsBinding.instance.addPostFrameCallback((_) {
    if (field.mounted) {
      unawaited(
        Scrollable.ensureVisible(
          field.context,
          alignment: 0.3,
          duration: BulkaMotion.duration(
            field.context,
            const Duration(milliseconds: 200),
          ),
          curve: Curves.easeOutCubic,
        ),
      );
    }
  });
  return false;
}
