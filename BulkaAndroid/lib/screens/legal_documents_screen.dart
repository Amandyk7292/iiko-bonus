part of '../main.dart';

class LegalDocumentsScreen extends StatefulWidget {
  const LegalDocumentsScreen({super.key});

  @override
  State<LegalDocumentsScreen> createState() => _LegalDocumentsScreenState();
}

class _LegalDocumentsScreenState extends State<LegalDocumentsScreen> {
  static const _documents = <_LegalDocumentEntry>[
    _LegalDocumentEntry(
      icon: Icons.privacy_tip_outlined,
      titleKey: 'legal_privacy',
      slug: 'privacy',
    ),
    _LegalDocumentEntry(
      icon: Icons.description_outlined,
      titleKey: 'legal_public_offer',
      slug: 'public-offer',
    ),
    _LegalDocumentEntry(
      icon: Icons.gavel_outlined,
      titleKey: 'legal_terms',
      slug: 'terms',
    ),
    _LegalDocumentEntry(
      icon: Icons.payments_outlined,
      titleKey: 'legal_payment_refund',
      slug: 'payment-and-refund',
    ),
    _LegalDocumentEntry(
      icon: Icons.local_shipping_outlined,
      titleKey: 'legal_delivery_terms',
      slug: 'delivery-terms',
    ),
    _LegalDocumentEntry(
      icon: Icons.account_balance_outlined,
      titleKey: 'legal_company_details',
      slug: 'company-details',
    ),
  ];

  final _navigationGate = _AsyncActionGate();

  Future<void> _openDocument(String slug) {
    return _navigationGate.run(() async {
      final opened = await launchUrl(
        bulkaLegalPageUri(slug),
        mode: LaunchMode.platformDefault,
      );
      if (!opened && mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('legal_open_error'.tr)));
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.bulkaColors;
    return Scaffold(
      appBar: AppBar(
        toolbarHeight: BulkaLayout.appBarHeight(context),
        title: _BulkaPageTitle('legal_documents_title'.tr),
        actions: const [SizedBox(width: BulkaLayout.appBarSideSlot)],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(18, 12, 18, 36),
        children: [
          Material(
            color: colors.surfaceCream,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(BulkaRadii.card),
              side: BorderSide(color: colors.cardBorder),
            ),
            clipBehavior: Clip.antiAlias,
            child: Column(
              children: [
                for (var index = 0; index < _documents.length; index++) ...[
                  _ProfileMenuItem(
                    icon: _documents[index].icon,
                    title: _documents[index].titleKey.tr,
                    onTap: () => _openDocument(_documents[index].slug),
                  ),
                  if (index < _documents.length - 1)
                    Divider(
                      height: 1,
                      indent: 60,
                      endIndent: 20,
                      color: colors.cardBorder,
                    ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _LegalDocumentEntry {
  const _LegalDocumentEntry({
    required this.icon,
    required this.titleKey,
    required this.slug,
  });

  final IconData icon;
  final String titleKey;
  final String slug;
}
