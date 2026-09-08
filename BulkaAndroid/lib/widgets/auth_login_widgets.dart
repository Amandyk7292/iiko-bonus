part of '../main.dart';

class _AuthLoginMethodSelector extends StatelessWidget {
  const _AuthLoginMethodSelector({
    required this.admin,
    required this.enabled,
    required this.onChanged,
  });

  final bool admin;
  final bool enabled;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: colors.disabledSurface.withValues(alpha: .45),
        borderRadius: BorderRadius.circular(BulkaRadii.control),
        border: Border.all(color: colors.cardBorder),
      ),
      child: Row(
        children: [
          for (final adminMethod in [false, true])
            Expanded(
              child: Semantics(
                selected: admin == adminMethod,
                inMutuallyExclusiveGroup: true,
                child: Material(
                  color: Colors.transparent,
                  child: InkWell(
                    key: ValueKey(
                      adminMethod
                          ? 'auth-method-password'
                          : 'auth-method-phone',
                    ),
                    borderRadius: BorderRadius.circular(BulkaRadii.control - 4),
                    onTap: enabled && admin != adminMethod
                        ? () => onChanged(adminMethod)
                        : null,
                    child: AnimatedContainer(
                      duration: BulkaMotion.duration(context, BulkaMotion.fast),
                      constraints: const BoxConstraints(minHeight: 48),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 10,
                      ),
                      decoration: BoxDecoration(
                        color: admin == adminMethod
                            ? colors.brandGold.withValues(alpha: .22)
                            : Colors.transparent,
                        borderRadius: BorderRadius.circular(
                          BulkaRadii.control - 4,
                        ),
                      ),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(
                            adminMethod
                                ? Icons.lock_outline_rounded
                                : Icons.phone_outlined,
                            size: 18,
                            color: colors.brandBrown,
                          ),
                          const SizedBox(width: 6),
                          Flexible(
                            child: Text(
                              (adminMethod
                                      ? 'auth_method_password'
                                      : 'auth_method_phone')
                                  .tr,
                              textAlign: TextAlign.center,
                              style: TextStyle(
                                fontFamily: _headingFont,
                                color: colors.brandBrown,
                                fontSize: BulkaTypeScale.bodySmall,
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
        ],
      ),
    );
  }
}

class _AuthStepHeader extends StatelessWidget {
  const _AuthStepHeader({
    this.step,
    required this.title,
    required this.subtitle,
  });

  final String? step;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (step != null) ...[
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
            decoration: BoxDecoration(
              color: _sage.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(BulkaRadii.pill),
            ),
            child: Text(
              step!,
              style: const TextStyle(
                fontFamily: _headingFont,
                color: _sage,
                fontSize: BulkaTypeScale.caption,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          const SizedBox(height: 14),
        ],
        Text(
          title,
          style: TextStyle(
            fontFamily: _headingFont,
            color: Theme.of(context).colorScheme.onSurface,
            fontSize: BulkaTypeScale.titleLarge,
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(height: 8),
        Text(
          subtitle,
          style: TextStyle(
            color: context.bulkaColors.mutedText,
            fontSize: BulkaTypeScale.body,
            height: 1.45,
          ),
        ),
      ],
    );
  }
}

const _authErrorRed = Color(0xFF982A24);

class _InlineAlert extends StatelessWidget {
  const _InlineAlert({required this.message, required this.icon});

  final String message;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      liveRegion: true,
      label: message,
      child: ExcludeSemantics(
        child: Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: _authErrorRed.withValues(alpha: 0.09),
            borderRadius: BorderRadius.circular(BulkaRadii.control),
            border: Border.all(color: _authErrorRed.withValues(alpha: 0.38)),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(icon, color: _authErrorRed, size: 20),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  message,
                  style: const TextStyle(
                    color: _authErrorRed,
                    fontSize: BulkaTypeScale.bodySmall,
                    height: 1.35,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
