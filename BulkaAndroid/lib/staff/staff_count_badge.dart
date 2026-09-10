part of '../main.dart';

class StaffCountBadge extends StatelessWidget {
  const StaffCountBadge({
    required this.count,
    required this.label,
    required this.child,
    super.key,
  });
  final int count;
  final String label;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    if (count <= 0) return child;
    return Tooltip(
      message: '$label: $count',
      child: Semantics(
        label: '$label: $count',
        child: Badge(
          backgroundColor: const Color(0xFFB42318),
          textColor: Colors.white,
          label: Text(
            count > 99 ? '99+' : '$count',
            style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700),
          ),
          child: child,
        ),
      ),
    );
  }
}
