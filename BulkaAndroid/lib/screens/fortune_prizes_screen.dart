part of '../main.dart';

class FortunePrizesScreen extends StatefulWidget {
  const FortunePrizesScreen({
    required this.api,
    this.onRefreshProfile,
    super.key,
  });
  final BulkaApiClient api;
  final Future<void> Function()? onRefreshProfile;

  @override
  State<FortunePrizesScreen> createState() => _FortunePrizesScreenState();
}

class _FortunePrizesScreenState extends State<FortunePrizesScreen> {
  @override
  Widget build(BuildContext context) => fortune_prizes.FortunePrizesView(
    api: widget.api,
    onRefreshProfile: widget.onRefreshProfile,
    pageTitle: (value) => _BulkaPageTitle(value),
    bindLiveRefresh: (refresh, busy) {
      final live = _LiveRefresh(
        widget.api,
        {'rewards', 'fortune', 'notification.created', 'customer.updated'},
        refresh,
        busy: busy,
      );
      return live.dispose;
    },
  );
}
