part of '../main.dart';

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({
    required this.customer,
    required this.onBack,
    required this.onLogout,
    super.key,
  });

  final Customer customer;
  final VoidCallback onBack;
  final Future<void> Function() onLogout;

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  String _selectedLang = 'Русский';

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

  void _showLanguageBottomSheet() {
    String tempLang = _selectedLang;

    showModalBottomSheet<void>(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setModalState) {
            final languages = ['Русский', 'Қазақша', 'English'];

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
                      InkWell(
                        onTap: () => Navigator.pop(context),
                        borderRadius: BorderRadius.circular(20),
                        child: Container(
                          width: 32,
                          height: 32,
                          decoration: const BoxDecoration(
                            color: Color(0xFFEADBBE),
                            shape: BoxShape.circle,
                          ),
                          child: const Icon(
                            Icons.close_rounded,
                            color: Colors.white,
                            size: 18,
                          ),
                        ),
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

  void _showInfoMessage(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
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
                  Text(
                    'profile_title'.tr,
                    style: const TextStyle(
                      color: Color(0xFF6D3317),
                      fontFamily: _headingFont,
                      fontSize: 20,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  _LogoutSplitButton(onLogout: () => widget.onLogout()),
                ],
              ),

              const SizedBox(height: 20),

              // User Profile Card
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
                              colors: [
                                Color(0xFFE5C583),
                                Color(0xFFB8924B),
                              ],
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
                            widget.customer.name,
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
                              color: const Color(0xFF6D3317).withValues(alpha: 0.65),
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
                      onTap: () => _showInfoMessage('Список заказов пуст'),
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
                      onTap: () => _showInfoMessage('Редактирование профиля'),
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
                      onTap: () => _showInfoMessage('Ваши сохранённые адреса'),
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
                      onTap: () => _showInfoMessage('Служба поддержки Bulka'),
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
                      onTap: () => _showInfoMessage('Bulka App v1.0'),
                    ),
                    const Divider(
                      height: 1,
                      indent: 60,
                      endIndent: 20,
                      color: Color(0xFFF3F3F3),
                    ),
                    _ProfileMenuItem(
                      icon: Icons.lock_outline_rounded,
                      title: 'menu_pin'.tr,
                      onTap: () => _showInfoMessage('Настройка PIN-кода'),
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
            Icon(
              icon,
              color: const Color(0xFF6D3317),
              size: 24,
            ),
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
    return InkWell(
      onTap: onLogout,
      borderRadius: BorderRadius.circular(20),
      child: CustomPaint(
        size: const Size(36, 36),
        painter: _SplitLogoutPainter(),
      ),
    );
  }
}

class _SplitLogoutPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;
    final rR = Radius.circular(size.width / 2);
    final clipPath = Path()..addRRect(RRect.fromRectAndRadius(rect, rR));

    canvas.save();
    canvas.clipPath(clipPath);

    // Left half: white
    final leftRect = Rect.fromLTRB(0, 0, size.width / 2, size.height);
    canvas.drawRect(leftRect, Paint()..color = Colors.white);

    // Right half: #6D3317
    final rightRect = Rect.fromLTRB(size.width / 2, 0, size.width, size.height);
    canvas.drawRect(rightRect, Paint()..color = const Color(0xFF6D3317));

    // Outer border around circle
    canvas.drawCircle(
      rect.center,
      size.width / 2 - 0.75,
      Paint()
        ..color = const Color(0xFF6D3317)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.5,
    );

    // Left half arrow in #6D3317
    canvas.save();
    canvas.clipRect(leftRect);
    _drawArrow(canvas, size, const Color(0xFF6D3317));
    canvas.restore();

    // Right half arrow in white
    canvas.save();
    canvas.clipRect(rightRect);
    _drawArrow(canvas, size, Colors.white);
    canvas.restore();

    canvas.restore();
  }

  void _drawArrow(Canvas canvas, Size size, Color color) {
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.2
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;

    final cx = size.width / 2;
    final cy = size.height / 2;

    // Arrow shaft: horizontal line
    canvas.drawLine(Offset(cx - 5, cy), Offset(cx + 5, cy), paint);

    // Arrow head pointing right ->
    final path = Path()
      ..moveTo(cx + 1, cy - 4.2)
      ..lineTo(cx + 5.5, cy)
      ..lineTo(cx + 1, cy + 4.2);
    canvas.drawPath(path, paint);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

