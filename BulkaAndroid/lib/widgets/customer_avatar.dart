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
                IconButton.filledTonal(
                  onPressed: () => Navigator.pop(sheetContext),
                  tooltip: 'close'.tr,
                  icon: const Icon(Icons.close_rounded),
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
                  return Semantics(
                    button: true,
                    selected: selected,
                    label: 'avatar_option'.trArgs({'number': index + 1}),
                    child: InkWell(
                      key: ValueKey('avatar-option-${option.key}'),
                      onTap: () {
                        BulkaMotion.selection();
                        Navigator.pop(sheetContext, option.key);
                      },
                      customBorder: const CircleBorder(),
                      child: Stack(
                        fit: StackFit.expand,
                        children: [
                          Container(
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              border: Border.all(
                                color: selected
                                    ? const Color(0xFFFFB814)
                                    : const Color(0xFFE8DDCC),
                                width: selected ? 4 : 1,
                              ),
                              boxShadow: selected
                                  ? BulkaShadows.selectedAvatar
                                  : null,
                            ),
                            padding: EdgeInsets.all(selected ? 3 : 1),
                            child: ClipOval(
                              child: Image.asset(
                                option.assetPath,
                                fit: BoxFit.cover,
                                filterQuality: FilterQuality.medium,
                              ),
                            ),
                          ),
                          if (selected)
                            Positioned(
                              right: 0,
                              bottom: 0,
                              child: Container(
                                width: 28,
                                height: 28,
                                decoration: const BoxDecoration(
                                  color: Color(0xFFFFB814),
                                  shape: BoxShape.circle,
                                ),
                                child: const Icon(
                                  Icons.check_rounded,
                                  size: 19,
                                  color: Colors.white,
                                ),
                              ),
                            ),
                        ],
                      ),
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
