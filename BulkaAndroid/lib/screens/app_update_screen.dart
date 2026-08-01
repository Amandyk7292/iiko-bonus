part of '../main.dart';

class RequiredAppUpdateScreen extends StatelessWidget {
  const RequiredAppUpdateScreen({
    required this.requirement,
    required this.onUpdate,
    super.key,
  });

  final RequiredAppUpdate requirement;
  final VoidCallback onUpdate;

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    final screen = MediaQuery.sizeOf(context);
    final compact = screen.height < 680;
    return Scaffold(
      key: const ValueKey('required-app-update-screen'),
      backgroundColor: const Color(0xFFFFFCF7),
      body: SafeArea(
        child: LayoutBuilder(
          builder: (context, constraints) => SingleChildScrollView(
            padding: EdgeInsets.fromLTRB(24, compact ? 16 : 28, 24, 24),
            child: ConstrainedBox(
              constraints: BoxConstraints(
                minHeight: max(0, constraints.maxHeight - 52),
              ),
              child: IntrinsicHeight(
                child: Column(
                  children: [
                    Align(
                      alignment: Alignment.centerLeft,
                      child: Image.asset(
                        'assets/brand/bulka_logo.png',
                        width: 92,
                        height: 46,
                        fit: BoxFit.contain,
                        semanticLabel: 'Bulka',
                      ),
                    ),
                    const Spacer(),
                    _UpdateIllustration(compact: compact),
                    SizedBox(height: compact ? 16 : 34),
                    Semantics(
                      header: true,
                      child: Text(
                        'app_update_title'.tr,
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontFamily: _headingFont,
                          color: colors.brandBrown,
                          fontSize: compact
                              ? BulkaTypeScale.titleLarge
                              : BulkaTypeScale.display,
                          height: 1.05,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                    SizedBox(height: compact ? 10 : 14),
                    ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 340),
                      child: Text(
                        'app_update_body'.tr,
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          color: colors.mutedText,
                          fontFamily: _descriptionFont,
                          fontSize: BulkaTypeScale.body,
                          height: 1.45,
                        ),
                      ),
                    ),
                    SizedBox(height: compact ? 10 : 12),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 14,
                        vertical: 7,
                      ),
                      decoration: BoxDecoration(
                        color: const Color(0xFFFFF3D8),
                        borderRadius: BorderRadius.circular(BulkaRadii.pill),
                      ),
                      child: Text(
                        'app_update_version'.trArgs({
                          'version': requirement.targetVersion,
                        }),
                        style: TextStyle(
                          color: colors.brandBrown,
                          fontFamily: _headingFont,
                          fontSize: BulkaTypeScale.bodySmall,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                    const Spacer(),
                    const SizedBox(height: 28),
                    GradientButton(
                      key: const ValueKey('required-app-update-button'),
                      onPressed: onUpdate,
                      child: Text(
                        'app_update_button'.tr,
                        style: const TextStyle(
                          fontFamily: _headingFont,
                          fontSize: BulkaTypeScale.body,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _UpdateIllustration extends StatelessWidget {
  const _UpdateIllustration({required this.compact});

  final bool compact;

  @override
  Widget build(BuildContext context) {
    final size = compact ? 152.0 : 214.0;
    return Semantics(
      image: true,
      label: 'app_update_illustration_semantics'.tr,
      child: SizedBox.square(
        dimension: size,
        child: Stack(
          alignment: Alignment.center,
          children: [
            Container(
              width: size * 0.88,
              height: size * 0.88,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(BulkaRadii.sheet),
                border: Border.all(color: const Color(0xFFF2D59B)),
                boxShadow: BulkaShadows.card,
              ),
              clipBehavior: Clip.antiAlias,
              child: Image.asset(
                'assets/brand/app_icon_master.png',
                fit: BoxFit.cover,
              ),
            ),
            Positioned(
              right: size * 0.02,
              bottom: size * 0.05,
              child: Container(
                width: size * 0.31,
                height: size * 0.31,
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [Color(0xFFFFD54F), Color(0xFFFFA000)],
                  ),
                  shape: BoxShape.circle,
                  border: Border.all(color: Colors.white, width: 4),
                  boxShadow: BulkaShadows.floatingAction,
                ),
                child: const Icon(
                  Icons.arrow_upward_rounded,
                  color: Colors.white,
                  size: 30,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
