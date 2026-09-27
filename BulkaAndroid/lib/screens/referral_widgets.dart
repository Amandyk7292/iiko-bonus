part of '../main.dart';

class _ReferralRegistrationField extends StatefulWidget {
  const _ReferralRegistrationField();
  @override
  State<_ReferralRegistrationField> createState() =>
      _ReferralRegistrationFieldState();
}

class _ReferralRegistrationFieldState
    extends State<_ReferralRegistrationField> {
  final _controller = TextEditingController();
  bool _edited = false;
  @override
  void initState() {
    super.initState();
    PendingReferral.read().then((code) {
      if (mounted && !_edited) _controller.text = code ?? '';
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => TextField(
    controller: _controller,
    textCapitalization: TextCapitalization.characters,
    autocorrect: false,
    maxLength: 14,
    decoration: InputDecoration(
      labelText: 'referral_registration_label'.tr,
      helperText: 'referral_registration_hint'.tr,
      helperMaxLines: 3,
      counterText: '',
    ),
    onChanged: (value) {
      _edited = true;
      unawaited(PendingReferral.set(value));
    },
  );
}

class _ReferralShareButton extends StatelessWidget {
  const _ReferralShareButton({required this.url});
  final String url;
  @override
  Widget build(BuildContext context) => FilledButton(
    onPressed: url.isEmpty
        ? null
        : () async {
            final box = context.findRenderObject() as RenderBox?;
            try {
              await SharePlus.instance.share(
                ShareParams(
                  text: '${'referral_share_message'.tr}\n$url',
                  sharePositionOrigin: box == null
                      ? null
                      : box.localToGlobal(Offset.zero) & box.size,
                ),
              );
            } catch (_) {
              if (context.mounted) {
                ScaffoldMessenger.of(context).showSnackBar(
                  bulkaSnackBar(content: Text('referral_share_error'.tr)),
                );
              }
            }
          },
    child: Text('referral_share_link'.tr),
  );
}
