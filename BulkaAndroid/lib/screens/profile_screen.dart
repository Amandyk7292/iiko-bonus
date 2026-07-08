part of '../main.dart';

class ProfileScreen extends StatelessWidget {
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
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Мой профиль'),
        leading: IconButton(
          onPressed: onBack,
          icon: const Icon(Icons.arrow_back_rounded),
        ),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 132),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SizedBox(height: 16),
              Row(
                children: [
                  Container(
                    width: 64,
                    height: 64,
                    decoration: const BoxDecoration(
                      color: _cocoa,
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(Icons.person, color: _almond, size: 40),
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          customer.name,
                          style: const TextStyle(
                            color: _textDark,
                            fontFamily: _headingFont,
                            fontSize: 24,
                            fontWeight: FontWeight.w400,
                          ),
                        ),
                        Text(
                          '+${customer.phone}',
                          style: TextStyle(
                            color: _textDark.withValues(alpha: 0.7),
                            fontSize: 16,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 32),
              Row(
                children: [
                  Expanded(
                    child: StatCard(
                      title: 'Покупок на',
                      value: '${formatMoney(customer.totalSpent)} ₸',
                    ),
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: StatCard(
                      title: 'Кэшбэк',
                      value: '${customer.cashbackPercent}%',
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 32),
              const Text(
                'Настройки',
                style: TextStyle(
                  color: _textDark,
                  fontFamily: _headingFont,
                  fontSize: 18,
                  fontWeight: FontWeight.w400,
                ),
              ),
              const SizedBox(height: 16),
              SettingTile(title: 'Служба поддержки', onTap: () {}),
              SettingTile(title: 'О приложении', onTap: () {}),
              SettingTile(
                title: 'Выйти из аккаунта',
                color: const Color(0xFFE53935),
                onTap: () => onLogout(),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class StatCard extends StatelessWidget {
  const StatCard({required this.title, required this.value, super.key});

  final String title;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Card(
      color: _cream,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(20),
        side: BorderSide(color: _almond.withValues(alpha: 0.45)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            Text(
              title,
              style: TextStyle(
                color: _textDark.withValues(alpha: 0.6),
                fontSize: 12,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              value,
              style: const TextStyle(
                color: _caramel,
                fontFamily: _headingFont,
                fontSize: 18,
                fontWeight: FontWeight.w400,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class SettingTile extends StatelessWidget {
  const SettingTile({
    required this.title,
    required this.onTap,
    this.color = _textDark,
    super.key,
  });

  final String title;
  final VoidCallback onTap;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(18),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 16),
        margin: const EdgeInsets.only(bottom: 8),
        decoration: BoxDecoration(
          color: _cream,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: _almond.withValues(alpha: 0.35)),
        ),
        child: Row(
          children: [
            Expanded(
              child: Text(
                title,
                style: TextStyle(
                  color: color,
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            Icon(
              Icons.chevron_right_rounded,
              color: color.withValues(alpha: 0.55),
            ),
          ],
        ),
      ),
    );
  }
}
