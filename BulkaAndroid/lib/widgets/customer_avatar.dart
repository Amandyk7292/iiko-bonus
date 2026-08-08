part of '../main.dart';

@immutable
class CustomerAvatarOption {
  const CustomerAvatarOption(this.key, this.assetPath);

  final String key;
  final String assetPath;
}

const List<CustomerAvatarOption> customerAvatarOptions = [
  CustomerAvatarOption('kz_female_01', 'assets/avatars/kz_female_01.webp'),
  CustomerAvatarOption('kz_female_02', 'assets/avatars/kz_female_02.webp'),
  CustomerAvatarOption('kz_female_03', 'assets/avatars/kz_female_03.webp'),
  CustomerAvatarOption('kz_female_04', 'assets/avatars/kz_female_04.webp'),
  CustomerAvatarOption('kz_female_05', 'assets/avatars/kz_female_05.webp'),
  CustomerAvatarOption('kz_female_06', 'assets/avatars/kz_female_06.webp'),
  CustomerAvatarOption('kz_male_01', 'assets/avatars/kz_male_01.webp'),
  CustomerAvatarOption('kz_male_02', 'assets/avatars/kz_male_02.webp'),
  CustomerAvatarOption('kz_male_03', 'assets/avatars/kz_male_03.webp'),
  CustomerAvatarOption('kz_male_04', 'assets/avatars/kz_male_04.webp'),
  CustomerAvatarOption('kz_male_05', 'assets/avatars/kz_male_05.webp'),
  CustomerAvatarOption('kz_male_06', 'assets/avatars/kz_male_06.webp'),
];

CustomerAvatarOption? _customerAvatarByKey(String? key) {
  if (key == null || key.isEmpty) return null;
  for (final option in customerAvatarOptions) {
    if (option.key == key) return option;
  }
  return null;
}

class CustomerAvatar extends StatelessWidget {
  const CustomerAvatar({
    required this.avatarKey,
    this.size = 64,
    this.showBorder = true,
    super.key,
  });

  final String? avatarKey;
  final double size;
  final bool showBorder;

  @override
  Widget build(BuildContext context) {
    final option = _customerAvatarByKey(avatarKey);
    final colors = context.bulkaColors;
    return Semantics(
      image: option != null,
      label: option == null ? 'avatar_not_selected'.tr : 'avatar_selected'.tr,
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          color: const Color(0xFFF8F4EC),
          shape: BoxShape.circle,
          border: showBorder
              ? Border.all(color: Colors.white, width: max(2, size * 0.045))
              : null,
          boxShadow: BulkaShadows.avatar,
        ),
        clipBehavior: Clip.antiAlias,
        child: option == null
            ? Icon(
                Icons.person_rounded,
                color: colors.goldSoft,
                size: size * 0.52,
              )
            : Image.asset(
                option.assetPath,
                key: ValueKey(option.key),
                fit: BoxFit.cover,
                filterQuality: FilterQuality.medium,
                frameBuilder: (context, child, frame, wasSynchronouslyLoaded) {
                  if (wasSynchronouslyLoaded || frame != null) return child;
                  return Icon(
                    Icons.person_rounded,
                    color: colors.goldSoft,
                    size: size * 0.52,
                  );
                },
                errorBuilder: (context, error, stackTrace) => Icon(
                  Icons.person_rounded,
                  color: colors.goldSoft,
                  size: size * 0.52,
                ),
              ),
      ),
    );
  }
}

Future<String?> showCustomerAvatarPicker(
  BuildContext context, {
  required String? selectedKey,
}) {
  return showModalBottomSheet<String>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: Colors.transparent,
    barrierColor: Colors.black.withValues(alpha: 0.48),
    builder: (sheetContext) {
      final height = MediaQuery.sizeOf(sheetContext).height;
      final scheme = Theme.of(sheetContext).colorScheme;
      final desiredHeight =
          120 + ((customerAvatarOptions.length / 3).ceil() * 112);
      return Container(
        height: min(height * 0.86, desiredHeight.toDouble()),
        decoration: const BoxDecoration(
          color: Color(0xFFFFFCF7),
          borderRadius: BorderRadius.vertical(
            top: Radius.circular(BulkaRadii.sheet),
          ),
        ),
        padding: const EdgeInsets.fromLTRB(22, 14, 22, 20),
        child: Column(
          children: [
            Container(
              width: 42,
              height: 4,
              decoration: BoxDecoration(
                color: const Color(0xFFD9CDBE),
                borderRadius: BorderRadius.circular(BulkaRadii.pill),
              ),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: Text(
                    'avatar_title'.tr,
                    style: const TextStyle(
                      fontFamily: _headingFont,
                      color: _textDark,
                      fontSize: BulkaTypeScale.title,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                IconButton(
                  key: const ValueKey('customer-avatar-close'),
                  onPressed: () => Navigator.pop(sheetContext),
                  tooltip: 'close_tooltip'.tr,
                  style: IconButton.styleFrom(
                    minimumSize: const Size(48, 48),
                    tapTargetSize: MaterialTapTargetSize.padded,
                    backgroundColor: scheme.secondaryContainer,
                    foregroundColor: scheme.onSecondaryContainer,
                    disabledBackgroundColor:
                        context.bulkaColors.disabledSurface,
                    disabledForegroundColor: context.bulkaColors.mutedText,
                  ),
                  icon: const Icon(Icons.close_rounded, size: 22),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Expanded(
              child: GridView.builder(
                key: const ValueKey('customer-avatar-grid'),
                padding: const EdgeInsets.symmetric(vertical: 8),
                gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                  crossAxisCount: 3,
                  mainAxisSpacing: 18,
                  crossAxisSpacing: 18,
                ),
                itemCount: customerAvatarOptions.length,
                itemBuilder: (context, index) {
                  final option = customerAvatarOptions[index];
                  final selected = option.key == selectedKey;
                  void selectAvatar() {
                    BulkaMotion.selection();
                    Navigator.pop(sheetContext, option.key);
                  }

                  return Semantics(
                    button: true,
                    selected: selected,
                    label: 'avatar_option'.trArgs({'number': index + 1}),
                    onTap: selectAvatar,
                    excludeSemantics: true,
                    child: Stack(
                      fit: StackFit.expand,
                      children: [
                        Material(
                          color: const Color(0xFFF8F4EC),
                          shape: CircleBorder(
                            side: BorderSide(
                              color: selected
                                  ? context.bulkaColors.brandBrown
                                  : const Color(0xFFE8DDCC),
                              width: selected ? 4 : 1,
                            ),
                          ),
                          elevation: selected ? 3 : 0,
                          shadowColor: context.bulkaColors.brandGold,
                          clipBehavior: Clip.antiAlias,
                          child: InkWell(
                            key: ValueKey('avatar-option-${option.key}'),
                            onTap: selectAvatar,
                            excludeFromSemantics: true,
                            customBorder: const CircleBorder(),
                            child: Ink.image(
                              image: AssetImage(option.assetPath),
                              fit: BoxFit.cover,
                              child: const SizedBox.expand(),
                            ),
                          ),
                        ),
                        if (selected)
                          Positioned(
                            right: 0,
                            bottom: 0,
                            child: IgnorePointer(
                              key: ValueKey(
                                'avatar-selected-hit-passthrough-${option.key}',
                              ),
                              child: Container(
                                key: ValueKey(
                                  'avatar-selected-indicator-${option.key}',
                                ),
                                width: 30,
                                height: 30,
                                decoration: BoxDecoration(
                                  color: context.bulkaColors.brandGold,
                                  shape: BoxShape.circle,
                                  border: Border.all(
                                    color: Colors.white,
                                    width: 2,
                                  ),
                                ),
                                child: Icon(
                                  Icons.check_rounded,
                                  size: 20,
                                  color: context.bulkaColors.brandBrown,
                                ),
                              ),
                            ),
                          ),
                      ],
                    ),
                  );
                },
              ),
            ),
          ],
        ),
      );
    },
  );
}
