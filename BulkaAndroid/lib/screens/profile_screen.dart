part of '../main.dart';

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({
    required this.api,
    required this.customer,
    required this.transactions,
    required this.onBack,
    required this.onLogout,
    required this.onRefreshProfile,
    required this.onOpenOrders,
    super.key,
  });

  final BulkaApiClient api;
  final Customer customer;
  final List<BonusTransaction> transactions;
  final VoidCallback onBack;
  final Future<void> Function() onLogout;
  final Future<void> Function() onRefreshProfile;
  final Future<void> Function() onOpenOrders;

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  final _navigationGate = _AsyncActionGate();

  String get _langCode {
    return AppLang.shortLabel(AppLang.current);
  }

  Future<void> _confirmLogout() async {
    await _navigationGate.run(() async {
      final bool? confirmed = await showDialog<bool>(
        context: context,
        builder: (BuildContext context) {
          final colors = context.bulkaColors;
          final scheme = Theme.of(context).colorScheme;
          return Dialog(
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(BulkaRadii.card),
            ),
            backgroundColor: scheme.surface,
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
                      color: colors.brandGold.withValues(alpha: 0.14),
                      shape: BoxShape.circle,
                    ),
                    alignment: Alignment.center,
                    child: Image.asset(
                      'assets/brand/entrance.png',
                      width: 32,
                      height: 32,
                      color: colors.brandBrown,
                      errorBuilder: (_, _, _) =>
                          const _EntranceVectorIcon(size: 32),
                    ),
                  ),
                  const SizedBox(height: 18),
                  Text(
                    'logout_confirm_title'.tr,
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: scheme.onSurface,
                      fontFamily: _headingFont,
                      fontSize: BulkaTypeScale.title,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 10),
                  Text(
                    'logout_confirm_msg'.tr,
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: colors.mutedText,
                      fontSize: BulkaTypeScale.body,
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
                            side: BorderSide(
                              color: colors.cardBorder,
                              width: 1.5,
                            ),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(
                                BulkaRadii.control,
                              ),
                            ),
                          ),
                          child: Text(
                            'logout_confirm_cancel'.tr,
                            style: TextStyle(
                              color: colors.brandBrown,
                              fontWeight: FontWeight.w600,
                              fontSize: BulkaTypeScale.body,
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: ElevatedButton(
                          onPressed: () => Navigator.of(context).pop(true),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: colors.brandGold,
                            padding: const EdgeInsets.symmetric(vertical: 14),
                            elevation: 0,
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(
                                BulkaRadii.control,
                              ),
                            ),
                          ),
                          child: Text(
                            'logout_confirm_yes'.tr,
                            style: const TextStyle(
                              fontFamily: _headingFont,
                              color: _textDark,
                              fontWeight: FontWeight.w700,
                              fontSize: BulkaTypeScale.body,
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
    });
  }

  Future<void> _showLanguageBottomSheet() async {
    await _navigationGate.run(() async {
      final code = await showLanguageBottomSheet(
        context,
        initialCode: AppLang.current,
      );
      if (code == null) return;
      await AppLang.setLanguage(code);
      if (!mounted) return;
      setState(() {});
    });
  }

  Future<void> _openPage(WidgetBuilder builder) async {
    await _navigationGate.run(() async {
      if (!mounted) return;
      await Navigator.of(
        context,
      ).push<void>(MaterialPageRoute(builder: builder));
    });
  }

  Future<void> _openPersonalData() => _openPage(
    (pageContext) => PersonalDataScreen(
      api: widget.api,
      customer: widget.customer,
      onBack: () => Navigator.pop(pageContext),
      onLogout: widget.onLogout,
      onProfileUpdated: widget.onRefreshProfile,
    ),
  );

  Future<void> _openOrders() async {
    await _navigationGate.run(widget.onOpenOrders);
  }

  Future<void> _openContact() async {
    await _navigationGate.run(() => _openTelegram(context));
  }

  Future<void> _openAbout() async {
    await _navigationGate.run(() async {
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        builder: (dialogContext) => AboutDialog(
          applicationName: 'app_title'.tr,
          applicationVersion: '1.0.0',
          applicationIcon: Image.asset(
            'assets/brand/bulka_logo.png',
            width: 72,
            height: 72,
          ),
          children: [Text('about_app_body'.tr)],
        ),
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    return Scaffold(
      backgroundColor: Theme.of(context).colorScheme.surface,
      body: SafeArea(
        child: SingleChildScrollView(
          padding: EdgeInsets.fromLTRB(
            20,
            12,
            20,
            BulkaLayout.bottomNavContentInset(context),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Top Bar
              Row(
                children: [
                  SizedBox(
                    width: 72,
                    child: Align(
                      alignment: Alignment.centerLeft,
                      child: InkWell(
                        onTap: _showLanguageBottomSheet,
                        borderRadius: BorderRadius.circular(BulkaRadii.control),
                        child: Padding(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 4,
                            vertical: 6,
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(
                                Icons.language_rounded,
                                color: colors.brandBrown,
                                size: 22,
                              ),
                              const SizedBox(width: 4),
                              Flexible(
                                child: Text(
                                  _langCode,
                                  maxLines: 1,
                                  overflow: TextOverflow.clip,
                                  style: TextStyle(
                                    color: colors.brandBrown,
                                    fontSize: BulkaTypeScale.body,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 6),
                      child: _BulkaPageTitle(
                        'profile_title'.tr,
                        key: const ValueKey('profile-page-title'),
                        color: colors.brandBrown,
                      ),
                    ),
                  ),
                  SizedBox(
                    width: 72,
                    child: Align(
                      alignment: Alignment.centerRight,
                      child: _LogoutSplitButton(onLogout: _confirmLogout),
                    ),
                  ),
                ],
              ),

              const SizedBox(height: 20),

              // User Profile Card
              // User Profile Card
              InkWell(
                onTap: _openPersonalData,
                borderRadius: BorderRadius.circular(BulkaRadii.card),
                child: Container(
                  decoration: BoxDecoration(
                    color: colors.surfaceCream,
                    borderRadius: BorderRadius.circular(BulkaRadii.card),
                    border: Border.all(color: colors.cardBorder),
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
                          borderRadius: BorderRadius.circular(
                            BulkaRadii.control,
                          ),
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
                              style: TextStyle(
                                fontFamily: _headingFont,
                                color: colors.brandBrown,
                                fontSize: BulkaTypeScale.body,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              widget.customer.phone,
                              style: TextStyle(
                                color: colors.mutedText,
                                fontSize: BulkaTypeScale.bodySmall,
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
                  color: colors.surfaceCream,
                  borderRadius: BorderRadius.circular(BulkaRadii.card),
                  border: Border.all(color: colors.cardBorder),
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
                      icon: Icons.shopping_bag_outlined,
                      title: 'menu_orders'.tr,
                      onTap: _openOrders,
                    ),
                    const Divider(
                      height: 1,
                      indent: 60,
                      endIndent: 20,
                      color: Color(0xFFF3F3F3),
                    ),
                    _ProfileMenuItem(
                      icon: Icons.card_giftcard_rounded,
                      title: 'rewards_title'.tr,
                      onTap: () =>
                          _openPage((_) => RewardsScreen(api: widget.api)),
                    ),
                    const Divider(
                      height: 1,
                      indent: 60,
                      endIndent: 20,
                      color: Color(0xFFF3F3F3),
                    ),
                    _ProfileMenuItem(
                      icon: Icons.receipt_long_outlined,
                      title: 'balance_history_title'.tr,
                      onTap: () => _openPage(
                        (_) => BalanceHistoryScreen(
                          transactions: widget.transactions,
                          onExplore: () {
                            Navigator.of(context).pop();
                            widget.onBack();
                          },
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
                      onTap: _openPersonalData,
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
                      onTap: () => _openPage(
                        (_) => AddressSelectionScreen(api: widget.api),
                      ),
                    ),
                    const Divider(
                      height: 1,
                      indent: 60,
                      endIndent: 20,
                      color: Color(0xFFF3F3F3),
                    ),
                    _ProfileMenuItem(
                      icon: Icons.credit_card_rounded,
                      title: 'payment_methods_title'.tr,
                      onTap: () => _openPage(
                        (_) => PaymentMethodsScreen(api: widget.api),
                      ),
                    ),
                    const Divider(
                      height: 1,
                      indent: 60,
                      endIndent: 20,
                      color: Color(0xFFF3F3F3),
                    ),
                    _ProfileMenuItem(
                      icon: Icons.notifications_active_outlined,
                      title: 'notifications_settings_title'.tr,
                      onTap: () => _openPage(
                        (_) => NotificationSettingsScreen(api: widget.api),
                      ),
                    ),
                    Divider(
                      height: 1,
                      indent: 60,
                      endIndent: 20,
                      color: colors.cardBorder,
                    ),
                    _ProfileMenuItem(
                      icon: Icons.support_agent_outlined,
                      title: 'support_title'.tr,
                      onTap: () =>
                          _openPage((_) => OrderSupportScreen(api: widget.api)),
                    ),
                    Divider(
                      height: 1,
                      indent: 60,
                      endIndent: 20,
                      color: colors.cardBorder,
                    ),
                    _ProfileMenuItem(
                      icon: Icons.mail_outline_rounded,
                      title: 'menu_contact'.tr,
                      onTap: _openContact,
                    ),
                    const Divider(
                      height: 1,
                      indent: 60,
                      endIndent: 20,
                      color: Color(0xFFF3F3F3),
                    ),
                    _ProfileMenuItem(
                      icon: Icons.account_balance_outlined,
                      title: 'legal_documents_title'.tr,
                      onTap: () =>
                          _openPage((_) => const LegalDocumentsScreen()),
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
                      onTap: _openAbout,
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
        borderRadius: BorderRadius.circular(BulkaRadii.card),
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
                    fontSize: BulkaTypeScale.body,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Align(
            alignment: Alignment.centerRight,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              decoration: BoxDecoration(
                color: const Color(0xFFFFB300).withValues(alpha: 0.25),
                borderRadius: BorderRadius.circular(BulkaRadii.control),
              ),
              child: Text(
                'tier_level'.trArgs({
                  'level': level.clamp(1, totalLevels),
                  'total': totalLevels,
                }),
                maxLines: 1,
                style: const TextStyle(
                  color: Color(0xFF6D3317),
                  fontSize: BulkaTypeScale.caption,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ),
          const SizedBox(height: 14),
          Text(
            description,
            style: const TextStyle(
              color: Color(0xFF6D3317),
              fontSize: BulkaTypeScale.bodySmall,
              height: 1.35,
              fontWeight: FontWeight.w500,
            ),
          ),
          const SizedBox(height: 12),
          ClipRRect(
            borderRadius: BorderRadius.circular(BulkaRadii.small),
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
            fontSize: BulkaTypeScale.caption,
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
    final colors = context.bulkaColors;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(BulkaRadii.card),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
        child: Row(
          children: [
            Icon(icon, color: colors.brandBrown, size: 24),
            const SizedBox(width: 16),
            Expanded(
              child: Text(
                title,
                style: TextStyle(
                  color: colors.brandBrown,
                  fontSize: BulkaTypeScale.body,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ),
            Icon(
              Icons.chevron_right_rounded,
              color: colors.brandBrown.withValues(alpha: 0.55),
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
    final colors = context.bulkaColors;
    return IconButton(
      onPressed: onLogout,
      tooltip: 'logout_confirm_yes'.tr,
      icon: Icon(Icons.logout_rounded, color: colors.brandBrown, size: 26),
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
