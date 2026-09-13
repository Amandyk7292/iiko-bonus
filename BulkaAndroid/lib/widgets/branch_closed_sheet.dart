part of '../main.dart';

Future<void> showBranchClosedSheet(
  BuildContext context, {
  required BakeryLocation branch,
  required String hours,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: Colors.transparent,
    barrierColor: Colors.black.withValues(alpha: .34),
    builder: (sheetContext) => _BranchClosedSheet(
      branch: branch,
      hours: hours,
      onClose: () => Navigator.of(sheetContext).pop(),
    ),
  );
}

class _BranchClosedSheet extends StatelessWidget {
  const _BranchClosedSheet({
    required this.branch,
    required this.hours,
    required this.onClose,
  });

  final BakeryLocation branch;
  final String hours;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    final bottom = MediaQuery.viewPaddingOf(context).bottom;
    return Align(
      alignment: Alignment.bottomCenter,
      child: Container(
        key: const ValueKey('branch-closed-sheet'),
        width: double.infinity,
        constraints: const BoxConstraints(maxWidth: 560),
        padding: EdgeInsets.fromLTRB(24, 10, 24, 24 + bottom),
        decoration: const BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.vertical(top: Radius.circular(32)),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 42,
              height: 4,
              decoration: BoxDecoration(
                color: const Color(0xFFD9D2CC),
                borderRadius: BorderRadius.circular(99),
              ),
            ),
            Align(
              alignment: Alignment.centerRight,
              child: IconButton.filledTonal(
                key: const ValueKey('branch-closed-close'),
                tooltip: 'close_tooltip'.tr,
                onPressed: onClose,
                style: IconButton.styleFrom(
                  backgroundColor: const Color(0xFFFFF3D5),
                  foregroundColor: _bulkaBrown,
                ),
                icon: const Icon(Icons.close_rounded),
              ),
            ),
            Semantics(
              image: true,
              label: 'branch_closed_title'.tr,
              child: Image.asset(
                'assets/illustrations/branch_closed_clock.png',
                key: const ValueKey('branch-closed-clock'),
                width: 205,
                height: 205,
                fit: BoxFit.contain,
                filterQuality: FilterQuality.high,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'branch_closed_title'.tr,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: _bulkaBrown,
                fontFamily: _headingFont,
                fontSize: 27,
                fontWeight: FontWeight.w700,
                height: 1.12,
              ),
            ),
            const SizedBox(height: 14),
            Text(
              branch.displayLabel,
              textAlign: TextAlign.center,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: context.bulkaColors.mutedText,
                fontSize: BulkaTypeScale.bodySmall,
                height: 1.3,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'branch_closed_hours'.trArgs({'hours': hours}),
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: _textDark,
                fontSize: BulkaTypeScale.body,
                fontWeight: FontWeight.w500,
                height: 1.35,
              ),
            ),
            const SizedBox(height: 24),
            SizedBox(
              width: double.infinity,
              height: 54,
              child: FilledButton(
                key: const ValueKey('branch-closed-ok'),
                onPressed: onClose,
                style: FilledButton.styleFrom(
                  backgroundColor: _bulkaYellow,
                  foregroundColor: _bulkaBrown,
                ),
                child: Text('branch_closed_ok'.tr),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
