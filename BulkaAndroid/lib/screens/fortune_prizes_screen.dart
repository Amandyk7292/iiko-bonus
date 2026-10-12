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
  late final Future<void> _ready = fortune_prizes.loadLibrary();

  @override
  Widget build(BuildContext context) => FutureBuilder<void>(
    future: _ready,
    builder: (context, snapshot) {
      if (snapshot.hasError) {
        return Scaffold(
          appBar: AppBar(title: _BulkaPageTitle(fortuneText('title'))),
          body: Center(
            child: OutlinedButton(
              onPressed: () => Navigator.of(context).pop(),
              child: Text(fortuneText('loadError')),
            ),
          ),
        );
      }
      if (snapshot.connectionState != ConnectionState.done) {
        return const Scaffold(body: Center(child: CircularProgressIndicator()));
      }
      return fortune_prizes.FortunePrizesView(
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
    },
  );
}
