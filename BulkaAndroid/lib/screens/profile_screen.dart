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

  Future<void> _loadLang() async {
    final prefs = await SharedPreferences.getInstance();
    if (!mounted) return;
    setState(() {
      _selectedLang = prefs.getString('user_lang_name') ?? 'Русский';
    });
  }

  String get _langCode {
    switch (_selectedLang) {
      case 'O\'zbek':
        return 'Uz';
      case 'Қазақша':
        return 'Kz';
      case 'English':
        return 'En';
      default:
        return 'Ru';
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
            final languages = ['Русский', 'O\'zbek', 'Қазақша', 'English'];

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
                      const Text(
                        'Выберите язык',
                        style: TextStyle(
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
                        final prefs = await SharedPreferences.getInstance();
                        await prefs.setString('user_lang_name', tempLang);
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
                      child: const Text(
                        'Применить',
                        style: TextStyle(
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
      backgroundColor: const Color(0xFFFAFAF7),
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
                            color: Color(0xFF231007),
                            size: 22,
                          ),
                          const SizedBox(width: 6),
                          Text(
                            _langCode,
                            style: const TextStyle(
                              color: Color(0xFF231007),
                              fontSize: 16,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  const Text(
                    'Профиль',
                    style: TextStyle(
                      color: Color(0xFF231007),
                      fontFamily: _headingFont,
                      fontSize: 20,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  InkWell(
                    onTap: () => widget.onLogout(),
                    borderRadius: BorderRadius.circular(20),
                    child: Container(
                      width: 36,
                      height: 36,
                      decoration: const BoxDecoration(
                        color: Color(0xFF4A2210),
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(
                        Icons.arrow_forward_rounded,
                        color: Colors.white,
                        size: 20,
                      ),
                    ),
                  ),
                ],
              ),

              const SizedBox(height: 20),

              // User Profile Card
              Container(
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(24),
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
                              color: Color(0xFF231007),
                              fontSize: 17,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            widget.customer.phone,
                            style: const TextStyle(
                              color: Color(0xFF9E9E9E),
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
                        color: Color(0xFF231007),
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
                      title: 'Мои заказы',
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
                      title: 'Личные данные',
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
                      title: 'Мои адреса',
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
                      title: 'Связаться с нами',
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
                      title: 'Информация',
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
                      title: 'Создать PIN-код',
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
              color: const Color(0xFFC5A059),
              size: 24,
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Text(
                title,
                style: const TextStyle(
                  color: Color(0xFF231007),
                  fontSize: 16,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ),
            const Icon(
              Icons.chevron_right_rounded,
              color: Color(0xFFD3C1A5),
              size: 22,
            ),
          ],
        ),
      ),
    );
  }
}
