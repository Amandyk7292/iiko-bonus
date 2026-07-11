part of '../main.dart';

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({
    required this.api,
    required this.customer,
    required this.transactions,
    required this.onBack,
    required this.onLogout,
    required this.onRefreshProfile,
    super.key,
  });

  final BulkaApiClient api;
  final Customer customer;
  final List<BonusTransaction> transactions;
  final VoidCallback onBack;
  final Future<void> Function() onLogout;
  final Future<void> Function() onRefreshProfile;

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  String _selectedLang = AppLang.languageName('ru');

  @override
  void initState() {
    super.initState();
    _loadLang();
  }

  void _loadLang() {
    setState(() {
      _selectedLang = AppLang.nameFromCode(AppLang.current);
    });
  }

  String get _langCode {
    return AppLang.shortLabel(AppLang.current);
  }

  Future<void> _confirmLogout() async {
    final bool? confirmed = await showDialog<bool>(
      context: context,
      builder: (BuildContext context) {
        return Dialog(
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(24),
          ),
          backgroundColor: const Color(0xFFFFFDF8),
          elevation: 8,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(24, 28, 24, 24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 64,
                  height: 64,
                  decoration: BoxDecoration(
                    color: const Color(0xFF6D3317).withValues(alpha: 0.1),
                    shape: BoxShape.circle,
                  ),
                  alignment: Alignment.center,
                  child: Image.asset(
                    'assets/brand/entrance.png',
                    width: 32,
                    height: 32,
                    color: const Color(0xFF6D3317),
                    errorBuilder: (_, _, _) =>
                        const _EntranceVectorIcon(size: 32),
                  ),
                ),
                const SizedBox(height: 18),
                Text(
                  'logout_confirm_title'.tr,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    color: Color(0xFF6D3317),
                    fontFamily: _headingFont,
                    fontSize: 20,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 10),
                Text(
                  'logout_confirm_msg'.tr,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    color: Color(0xFF5A4D46),
                    fontSize: 15,
                    height: 1.35,
                  ),
                ),
                const SizedBox(height: 24),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        onPressed: () => Navigator.of(context).pop(false),
                        style: OutlinedButton.styleFrom(
                          padding: const EdgeInsets.symmetric(vertical: 14),
                          side: const BorderSide(
                            color: Color(0xFFE2D6CA),
                            width: 1.5,
                          ),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(14),
                          ),
                        ),
                        child: Text(
                          'logout_confirm_cancel'.tr,
                          style: const TextStyle(
                            color: Color(0xFF6D3317),
                            fontWeight: FontWeight.w600,
                            fontSize: 15,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: ElevatedButton(
                        onPressed: () => Navigator.of(context).pop(true),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: const Color(0xFF6D3317),
                          padding: const EdgeInsets.symmetric(vertical: 14),
                          elevation: 0,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(14),
                          ),
                        ),
                        child: Text(
                          'logout_confirm_yes'.tr,
                          style: const TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.w700,
                            fontSize: 15,
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        );
      },
    );

    if (confirmed == true) {
      await widget.onLogout();
    }
  }

  void _showLanguageBottomSheet() {
    String tempLang = _selectedLang;

    showModalBottomSheet<void>(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setModalState) {
            final languages = [
              AppLang.languageName('ru'),
              AppLang.languageName('kk'),
              AppLang.languageName('en'),
            ];

            return Container(
              decoration: const BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
              ),
              padding: const EdgeInsets.fromLTRB(24, 20, 24, 32),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const SizedBox(width: 36),
                      Text(
                        'select_lang_title'.tr,
                        style: const TextStyle(
                          color: Color(0xFF231007),
                          fontFamily: _headingFont,
                          fontSize: 20,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      IconButton(
                        onPressed: () => Navigator.pop(context),
                        tooltip: 'close_tooltip'.tr,
                        style: IconButton.styleFrom(
                          backgroundColor: const Color(0xFFEADBBE),
                          foregroundColor: Colors.white,
                        ),
                        icon: const Icon(Icons.close_rounded, size: 18),
                      ),
                    ],
                  ),
                  const SizedBox(height: 20),
                  ...languages.map((lang) {
                    final isSelected = tempLang == lang;
                    return InkWell(
                      onTap: () {
                        setModalState(() {
                          tempLang = lang;
                        });
                      },
                      child: Padding(
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Text(
                              lang,
                              style: TextStyle(
                                fontSize: 17,
                                color: isSelected
                                    ? const Color(0xFFC5A059)
                                    : const Color(0xFF6D3317),
                                fontWeight: isSelected
                                    ? FontWeight.w600
                                    : FontWeight.w400,
                              ),
                            ),
                            Container(
                              width: 22,
                              height: 22,
                              decoration: BoxDecoration(
                                shape: BoxShape.circle,
                                color: isSelected
                                    ? const Color(0xFFDEC588)
                                    : const Color(0xFFEEEEEE),
                              ),
                              child: isSelected
                                  ? Center(
                                      child: Container(
                                        width: 8,
                                        height: 8,
                                        decoration: const BoxDecoration(
                                          color: Colors.white,
                                          shape: BoxShape.circle,
                                        ),
                                      ),
                                    )
                                  : null,
                            ),
                          ],
                        ),
                      ),
                    );
                  }),
                  const SizedBox(height: 24),
                  SizedBox(
                    width: double.infinity,
                    height: 52,
                    child: ElevatedButton(
                      onPressed: () async {
                        await AppLang.setLanguage(
                          AppLang.codeFromName(tempLang),
                        );
                        if (!context.mounted) return;
                        setState(() {
                          _selectedLang = tempLang;
                        });
                        Navigator.pop(context);
                      },
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFFDEC588),
                        foregroundColor: Colors.white,
                        elevation: 0,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(22),
                        ),
                      ),
                      child: Text(
                        'apply_btn'.tr,
                        style: const TextStyle(
                          fontSize: 17,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            );
          },
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 110),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Top Bar
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      IconButton(
                        onPressed: widget.onBack,
                        tooltip: 'back_tooltip'.tr,
                        icon: const Icon(
                          Icons.arrow_back_ios_new_rounded,
                          color: Color(0xFF6D3317),
                          size: 20,
                        ),
                      ),
                      const SizedBox(width: 4),
                      InkWell(
                        onTap: _showLanguageBottomSheet,
                        borderRadius: BorderRadius.circular(20),
                        child: Padding(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 6,
                          ),
                          child: Row(
                            children: [
                              const Icon(
                                Icons.language_rounded,
                                color: Color(0xFF6D3317),
                                size: 22,
                              ),
                              const SizedBox(width: 6),
                              Text(
                                _langCode,
                                style: const TextStyle(
                                  color: Color(0xFF6D3317),
                                  fontSize: 16,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                  Text(
                    'profile_title'.tr,
                    style: const TextStyle(
                      color: Color(0xFF6D3317),
                      fontFamily: _headingFont,
                      fontSize: 20,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  _LogoutSplitButton(onLogout: _confirmLogout),
                ],
              ),

              const SizedBox(height: 20),

              // User Profile Card
              // User Profile Card
              InkWell(
                onTap: () {
                  Navigator.push(
                    context,
                    MaterialPageRoute(
                      builder: (context) => PersonalDataScreen(
                        api: widget.api,
                        customer: widget.customer,
                        onBack: () => Navigator.pop(context),
                        onLogout: widget.onLogout,
                        onProfileUpdated: widget.onRefreshProfile,
                      ),
                    ),
                  );
                },
                borderRadius: BorderRadius.circular(24),
                child: Container(
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(24),
                    border: Border.all(
                      color: const Color(0xFF6D3317).withValues(alpha: 0.10),
                    ),
                    boxShadow: const [
                      BoxShadow(
                        color: Color(0x0C000000),
                        blurRadius: 16,
                        offset: Offset(0, 4),
                      ),
                    ],
                  ),
                  padding: const EdgeInsets.all(18),
                  child: Row(
                    children: [
                      Container(
                        width: 64,
                        height: 64,
                        decoration: BoxDecoration(
                          color: const Color(0xFFF8F5EE),
                          borderRadius: BorderRadius.circular(20),
                          boxShadow: const [
                            BoxShadow(
                              color: Color(0x0A000000),
                              blurRadius: 8,
                              offset: Offset(0, 2),
                            ),
                          ],
                        ),
                        child: Center(
                          child: Container(
                            width: 44,
                            height: 44,
                            decoration: const BoxDecoration(
                              shape: BoxShape.circle,
                              gradient: LinearGradient(
                                begin: Alignment.topLeft,
                                end: Alignment.bottomRight,
                                colors: [Color(0xFFE5C583), Color(0xFFB8924B)],
                              ),
                            ),
                            child: const Icon(
                              Icons.person_rounded,
                              color: Colors.white,
                              size: 28,
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(width: 16),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              isGuestName(widget.customer.name)
                                  ? 'guest_name'.tr
                                  : widget.customer.name,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: Color(0xFF6D3317),
                                fontSize: 17,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              widget.customer.phone,
                              style: TextStyle(
                                color: const Color(
                                  0xFF6D3317,
                                ).withValues(alpha: 0.65),
                                fontSize: 14,
                                fontWeight: FontWeight.w400,
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: 8),
                      Container(
                        width: 28,
                        height: 28,
                        decoration: const BoxDecoration(
                          color: Color(0xFFF8F5EE),
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(
                          Icons.chevron_right_rounded,
                          color: Color(0xFF6D3317),
                          size: 20,
                        ),
                      ),
                    ],
                  ),
                ),
              ),

              const SizedBox(height: 16),

              // Loyalty Status Progress Card
              _buildLoyaltyProgressCard(),

              const SizedBox(height: 20),

              // Menu List Card
              Container(
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(24),
                  border: Border.all(
                    color: const Color(0xFF6D3317).withValues(alpha: 0.10),
                  ),
                  boxShadow: const [
                    BoxShadow(
                      color: Color(0x0C000000),
                      blurRadius: 16,
                      offset: Offset(0, 4),
                    ),
                  ],
                ),
                child: Column(
                  children: [
                    _ProfileMenuItem(
                      icon: Icons.receipt_long_outlined,
                      title: 'menu_orders'.tr,
                      onTap: () => Navigator.of(context).push<void>(
                        MaterialPageRoute(
                          builder: (_) => OrdersScreen(
                            transactions: widget.transactions,
                            onExplore: () {
                              Navigator.of(context).pop();
                              widget.onBack();
                            },
                          ),
                        ),
                      ),
                    ),
                    const Divider(
                      height: 1,
                      indent: 60,
                      endIndent: 20,
                      color: Color(0xFFF3F3F3),
                    ),
                    _ProfileMenuItem(
                      icon: Icons.person_outline_rounded,
                      title: 'menu_personal'.tr,
                      onTap: () {
                        Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (context) => PersonalDataScreen(
                              api: widget.api,
                              customer: widget.customer,
                              onBack: () => Navigator.pop(context),
                              onLogout: widget.onLogout,
                              onProfileUpdated: widget.onRefreshProfile,
                            ),
                          ),
                        );
                      },
                    ),
                    const Divider(
                      height: 1,
                      indent: 60,
                      endIndent: 20,
                      color: Color(0xFFF3F3F3),
                    ),
                    _ProfileMenuItem(
                      icon: Icons.location_on_outlined,
                      title: 'menu_addresses'.tr,
                      onTap: () => Navigator.of(context).push<void>(
                        MaterialPageRoute(
                          builder: (_) => const AddressSelectionScreen(),
                        ),
                      ),
                    ),
                    const Divider(
                      height: 1,
                      indent: 60,
                      endIndent: 20,
                      color: Color(0xFFF3F3F3),
                    ),
                    _ProfileMenuItem(
                      icon: Icons.mail_outline_rounded,
                      title: 'menu_contact'.tr,
                      onTap: () => _openTelegram(context),
                    ),
                    const Divider(
                      height: 1,
                      indent: 60,
                      endIndent: 20,
                      color: Color(0xFFF3F3F3),
                    ),
                    _ProfileMenuItem(
                      icon: Icons.menu_book_rounded,
                      title: 'menu_info'.tr,
                      onTap: () => showAboutDialog(
                        context: context,
                        applicationName: 'app_title'.tr,
                        applicationVersion: '1.0.0',
                        applicationIcon: Image.asset(
                          'assets/brand/bulka_logo.png',
                          width: 72,
                          height: 72,
                        ),
                        children: [Text('about_app_body'.tr)],
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildLoyaltyProgressCard() {
    final customer = widget.customer;
    final tier = customer.tier;
    final currentName = tier?.localizedName ?? 'tier_base'.tr;
    final percent = tier?.percent ?? customer.cashbackPercent;
    final tiers = tier?.allTiers ?? const <TierItem>[];
    final level = max(tier?.level ?? 1, 1);
    final totalLevels = max(tiers.length, level);
    final nextName = tier?.localizedNextTier;
    var nextPercent = tier?.nextPercent ?? percent;
    if (tier != null && nextName != null) {
      for (final item in tiers) {
        if (item.name == tier.nextTier || item.localizedName == nextName) {
          nextPercent = item.percent;
          break;
        }
      }
      if (nextPercent == percent && level < tiers.length) {
        nextPercent = tiers[level].percent;
      }
    }
    final progress = tier != null
        ? tier.progressFraction
        : customer.vipThreshold > 0
        ? (customer.totalSpent / customer.vipThreshold).clamp(0.0, 1.0)
        : 0.0;
    final description = tier == null
        ? 'tier_current'.trArgs({'percent': percent})
        : nextName == null
        ? 'tier_max'.trArgs({'name': currentName, 'percent': percent})
        : 'tier_next'.trArgs({
            'name': nextName,
            'percent': nextPercent,
            'remaining': formatGroupedNumber(tier.remaining),
          });

    return Container(
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFFFFF9E6), Color(0xFFFFF2CD)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(
          color: const Color(0xFFFFB300).withValues(alpha: 0.4),
        ),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0C000000),
            blurRadius: 16,
            offset: Offset(0, 4),
          ),
        ],
      ),
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      padding: const EdgeInsets.all(8),
                      decoration: const BoxDecoration(
                        color: Color(0xFFFFB300),
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(
                        Icons.workspace_premium_rounded,
                        color: Colors.white,
                        size: 20,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        'tier_status'.trArgs({
                          'name': currentName,
                          'percent': percent,
                        }),
                        style: const TextStyle(
                          color: Color(0xFF4E2C1E),
                          fontFamily: _headingFont,
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 4,
                ),
                decoration: BoxDecoration(
                  color: const Color(0xFFFFB300).withValues(alpha: 0.25),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(
                  'tier_level'.trArgs({
                    'level': level.clamp(1, totalLevels),
                    'total': totalLevels,
                  }),
                  style: const TextStyle(
                    color: Color(0xFF6D3317),
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          Text(
            description,
            style: const TextStyle(
              color: Color(0xFF6D3317),
              fontSize: 13.5,
              height: 1.35,
              fontWeight: FontWeight.w500,
            ),
          ),
          const SizedBox(height: 12),
          ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: LinearProgressIndicator(
              value: progress,
              minHeight: 10,
              backgroundColor: const Color(0xFFEFE5CE),
              valueColor: const AlwaysStoppedAnimation<Color>(
                Color(0xFFFF9800),
              ),
            ),
          ),
          const SizedBox(height: 12),
          if (tiers.isNotEmpty)
            Wrap(
              spacing: 10,
              runSpacing: 8,
              children: [
                for (var index = 0; index < tiers.length; index++)
                  _buildTierLabel(
                    '${tiers[index].localizedName} ${tiers[index].percent}%',
                    index < level,
                  ),
              ],
            ),
        ],
      ),
    );
  }

  Widget _buildTierLabel(String title, bool achieved) {
    return Row(
      children: [
        Icon(
          achieved ? Icons.check_circle_rounded : Icons.radio_button_unchecked,
          size: 14,
          color: achieved ? const Color(0xFFFF9800) : const Color(0xFFAFA28D),
        ),
        const SizedBox(width: 4),
        Text(
          title,
          style: TextStyle(
            color: achieved ? const Color(0xFF4E2C1E) : const Color(0xFFAFA28D),
            fontSize: 12,
            fontWeight: achieved ? FontWeight.w700 : FontWeight.w500,
          ),
        ),
      ],
    );
  }
}

class _ProfileMenuItem extends StatelessWidget {
  const _ProfileMenuItem({
    required this.icon,
    required this.title,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(24),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
        child: Row(
          children: [
            Icon(icon, color: const Color(0xFF6D3317), size: 24),
            const SizedBox(width: 16),
            Expanded(
              child: Text(
                title,
                style: const TextStyle(
                  color: Color(0xFF6D3317),
                  fontSize: 16,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ),
            Icon(
              Icons.chevron_right_rounded,
              color: const Color(0xFF6D3317).withValues(alpha: 0.45),
              size: 22,
            ),
          ],
        ),
      ),
    );
  }
}

class _LogoutSplitButton extends StatelessWidget {
  const _LogoutSplitButton({required this.onLogout});

  final VoidCallback onLogout;

  @override
  Widget build(BuildContext context) {
    return IconButton(
      onPressed: onLogout,
      tooltip: 'logout_confirm_yes'.tr,
      icon: Image.asset(
        'assets/brand/entrance.png',
        width: 26,
        height: 26,
        color: const Color(0xFF6D3317),
        errorBuilder: (_, _, _) => const _EntranceVectorIcon(size: 26),
      ),
    );
  }
}

class _EntranceVectorIcon extends StatelessWidget {
  final double size;
  const _EntranceVectorIcon({this.size = 26});

  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      size: Size(size, size),
      painter: _EntranceVectorPainter(),
    );
  }
}

class _EntranceVectorPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final Paint p = Paint()
      ..color = const Color(0xFF6D3317)
      ..style = PaintingStyle.fill;

    final double w = size.width;
    final double h = size.height;

    final Path door = Path()
      ..moveTo(w * 0.55, h * 0.1)
      ..lineTo(w * 0.88, h * 0.1)
      ..lineTo(w * 0.88, h * 0.9)
      ..lineTo(w * 0.55, h * 0.9)
      ..lineTo(w * 0.55, h * 0.78)
      ..lineTo(w * 0.78, h * 0.78)
      ..lineTo(w * 0.78, h * 0.22)
      ..lineTo(w * 0.55, h * 0.22)
      ..close();

    final Path arrow = Path()
      ..moveTo(w * 0.12, h * 0.43)
      ..lineTo(w * 0.52, h * 0.43)
      ..lineTo(w * 0.52, h * 0.28)
      ..lineTo(w * 0.74, h * 0.50)
      ..lineTo(w * 0.52, h * 0.72)
      ..lineTo(w * 0.52, h * 0.57)
      ..lineTo(w * 0.12, h * 0.57)
      ..close();

    canvas.drawPath(door, p);
    canvas.drawPath(arrow, p);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
