part of '../main.dart';

class _FamilyPanel extends StatelessWidget {
  const _FamilyPanel({required this.child, this.padding = 16});
  final Widget child;
  final double padding;
  @override
  Widget build(BuildContext context) => Container(
    padding: EdgeInsets.all(padding),
    decoration: BoxDecoration(
      color: context.bulkaColors.surfaceCream,
      borderRadius: BorderRadius.circular(24),
      boxShadow: [
        BoxShadow(
          color: context.bulkaColors.brandBrown.withValues(alpha: 0.05),
          blurRadius: 24,
          offset: const Offset(0, 8),
        ),
      ],
    ),
    child: child,
  );
}

class _FamilyAvatar extends StatelessWidget {
  const _FamilyAvatar({required this.name, this.child = false});
  final String name;
  final bool child;
  static const double size = 44;
  @override
  Widget build(BuildContext context) => Container(
    width: size,
    height: size,
    alignment: Alignment.center,
    decoration: BoxDecoration(
      shape: BoxShape.circle,
      color: context.bulkaColors.brandGold.withValues(
        alpha: child ? 0.3 : 0.14,
      ),
    ),
    child: child
        ? Icon(Icons.face_rounded, size: size * 0.56)
        : Text(
            name.trim().isEmpty
                ? 'B'
                : name.trim().characters.first.toUpperCase(),
            style: TextStyle(fontFamily: _headingFont, fontSize: size * 0.42),
          ),
  );
}

class _FamilyBonusHero extends StatelessWidget {
  const _FamilyBonusHero({required this.balance, this.owner, this.members = 0});
  final double balance;
  final String? owner;
  final int members;
  @override
  Widget build(BuildContext context) => ClipRRect(
    borderRadius: BorderRadius.circular(24),
    child: Container(
      decoration: const BoxDecoration(
        gradient: _bulkaGlassGradient,
        image: DecorationImage(
          image: AssetImage('assets/brand/loyalty_background.jpg'),
          fit: BoxFit.cover,
          opacity: 0.4,
        ),
      ),
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.family_restroom_rounded, size: 22),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  _familyText('sharedBonus'),
                  style: const TextStyle(fontSize: 13),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            '${formatGroupedNumber(balance)} ${_familyText('bonusUnit')}',
            style: const TextStyle(
              fontFamily: _headingFont,
              fontSize: 30,
              height: 1.15,
            ),
          ),
          if (owner?.isNotEmpty == true || members > 0) ...[
            const SizedBox(height: 12),
            Row(
              children: [
                Icon(
                  owner == null
                      ? Icons.people_outline_rounded
                      : Icons.person_outline_rounded,
                  size: 16,
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    owner ?? '${_familyText('members')}: $members',
                    style: const TextStyle(fontSize: 12),
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    ),
  );
}

class _FamilyRoleChip extends StatelessWidget {
  const _FamilyRoleChip(this.text, {this.blocked = false});
  final String text;
  final bool blocked;
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
    decoration: BoxDecoration(
      color: blocked
          ? context.bulkaColors.danger.withValues(alpha: 0.08)
          : context.bulkaColors.brandGold.withValues(alpha: 0.1),
      borderRadius: BorderRadius.circular(8),
    ),
    child: Text(
      text,
      style: TextStyle(
        fontSize: 11,
        color: blocked
            ? context.bulkaColors.danger
            : context.bulkaColors.brandBrown,
      ),
    ),
  );
}

class _FamilyAllowance extends StatelessWidget {
  const _FamilyAllowance({required this.remaining, required this.limit});
  final double remaining;
  final double limit;
  @override
  Widget build(BuildContext context) => _FamilyPanel(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Icon(
              Icons.account_balance_wallet_outlined,
              size: 20,
              color: context.bulkaColors.brandBrown,
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                _familyText('remainingShort'),
                style: const TextStyle(fontSize: 12),
              ),
            ),
            Text(
              '${formatMoney(remaining)} ₸',
              style: const TextStyle(fontFamily: _headingFont, fontSize: 18),
            ),
          ],
        ),
        const SizedBox(height: 12),
        ClipRRect(
          borderRadius: BorderRadius.circular(8),
          child: LinearProgressIndicator(
            value: limit > 0 ? (remaining / limit).clamp(0, 1) : 0,
            minHeight: 5,
            color: context.bulkaColors.brandGold,
            backgroundColor: context.bulkaColors.disabledSurface,
          ),
        ),
        const SizedBox(height: 8),
        Text(
          '${_familyText('dailyLimit')}: ${formatMoney(limit)} ₸',
          style: TextStyle(fontSize: 11, color: context.bulkaColors.mutedText),
        ),
      ],
    ),
  );
}

Color _familyCanvas(BuildContext context) => Color.alphaBlend(
  context.bulkaColors.brandGold.withValues(alpha: 0.04),
  context.bulkaColors.surfaceCream,
);
