part of '../main.dart';

class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({required this.api, super.key});
  final BulkaApiClient api;

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  late Future<List<AppNotification>> _future = widget.api.getNotifications();

  Future<void> _reload() async {
    setState(() => _future = widget.api.getNotifications());
    await _future;
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: Colors.white,
    appBar: AppBar(
      title: Text('notification_center_title'.tr),
      actions: [
        TextButton(
          onPressed: () async {
            await widget.api.markAllNotificationsRead();
            await _reload();
          },
          child: Text('notifications_read_all'.tr),
        ),
      ],
    ),
    body: FutureBuilder<List<AppNotification>>(
      future: _future,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return const Center(
            child: CircularProgressIndicator(color: _caramel),
          );
        }
        final items = snapshot.data ?? const <AppNotification>[];
        if (items.isEmpty) {
          return Center(child: Text('notifications_empty'.tr));
        }
        return RefreshIndicator(
          color: _caramel,
          onRefresh: _reload,
          child: ListView.separated(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
            itemCount: items.length,
            separatorBuilder: (_, _) => const SizedBox(height: 10),
            itemBuilder: (context, index) {
              final item = items[index];
              return InkWell(
                onTap: item.isRead
                    ? null
                    : () async {
                        await widget.api.markNotificationRead(item.id);
                        await _reload();
                      },
                borderRadius: BorderRadius.circular(18),
                child: Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: item.isRead
                        ? _cream
                        : _almond.withValues(alpha: .28),
                    borderRadius: BorderRadius.circular(18),
                    border: Border.all(color: _almond.withValues(alpha: .55)),
                  ),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Icon(
                        item.isRead
                            ? Icons.notifications_none_rounded
                            : Icons.notifications_active_rounded,
                        color: _caramel,
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              item.title,
                              style: const TextStyle(
                                color: _textDark,
                                fontWeight: FontWeight.w800,
                                fontSize: 16,
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              item.body,
                              style: TextStyle(
                                color: _textDark.withValues(alpha: .7),
                                height: 1.3,
                              ),
                            ),
                            if (item.createdAt.isNotEmpty) ...[
                              const SizedBox(height: 8),
                              Text(
                                item.createdAt
                                    .replaceFirst('T', ' ')
                                    .split('.')
                                    .first,
                                style: TextStyle(
                                  color: _textDark.withValues(alpha: .45),
                                  fontSize: 12,
                                ),
                              ),
                            ],
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              );
            },
          ),
        );
      },
    ),
  );
}
