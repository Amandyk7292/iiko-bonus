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
    this.onAvatarSaved,
    super.key,
  });

  final BulkaApiClient api;
  final Customer customer;
  final List<BonusTransaction> transactions;
  final VoidCallback onBack;
  final Future<void> Function() onLogout;
  final Future<void> Function() onRefreshProfile;
  final Future<void> Function() onOpenOrders;
  final CustomerAvatarSavedCallback? onAvatarSaved;

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  final _navigationGate = _AsyncActionGate();

  @override
  void initState() {
    super.initState();
    if (forteCardSetupReturnFromUri(currentClientUri()) != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) {
          unawaited(_openPage((_) => PaymentMethodsScreen(api: widget.api)));
        }
      });
    }
  }

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
        try {
          await widget.onLogout();
        } catch (error) {
          if (!mounted) return;
          showApiErrorSnackBar(
            context,
            error,
            fallbackKey: 'logout_failed_retry',
          );
        }
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
      onAvatarSaved:
          widget.onAvatarSaved ??
          ({required customerId, required phone, required avatarKey}) =>
              widget.onRefreshProfile(),
    ),
  );

  Future<void> _openOrders() async {
    await _navigationGate.run(widget.onOpenOrders);
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
                      CustomerAvatar(
                        avatarKey: widget.customer.avatarKey,
                        size: 64,
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
                      icon: Icons.support_agent_outlined,
                      title: 'support_title'.tr,
                      onTap: () =>
                          _openPage((_) => OrderSupportScreen(api: widget.api)),
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
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildLoyaltyProgressCard() => LoyaltyTierCard(
    tier: widget.customer.tier,
    cashbackPercent: widget.customer.cashbackPercent,
    totalSpent: widget.customer.totalSpent,
    vipThreshold: widget.customer.vipThreshold.toDouble(),
  );
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
