part of '../main.dart';

/// Called only after the customer approves the displayed cart. Normal checkout
/// will request its own authoritative quote and handle authentication/payment.
Future<void> importReviewedChatGptCart({
  required BulkaApiClient api,
  required CartProvider cart,
  required ChatGptCartDraft draft,
  required String reviewedCartRevision,
}) async {
  draft.ensureUnexpired();
  if (draft.requiresSelection ||
      cart.checkoutRevision != reviewedCartRevision) {
    throw ApiException(
      _chatGptCartError('CHATGPT_CART_CHANGED'),
      code: 'CHATGPT_CART_CHANGED',
    );
  }
  final session = api.sessionCacheScope;
  await PendingForteOperationStore.prepareNewCheckout(api);
  if (session != api.sessionCacheScope ||
      cart.checkoutRevision != reviewedCartRevision) {
    throw ApiException(
      _chatGptCartError('CHATGPT_CART_CHANGED'),
      code: 'CHATGPT_CART_CHANGED',
    );
  }
  final prefs = await SharedPreferences.getInstance();
  draft.ensureUnexpired();
  if (session != api.sessionCacheScope ||
      cart.checkoutRevision != reviewedCartRevision) {
    throw ApiException(
      _chatGptCartError('CHATGPT_CART_CHANGED'),
      code: 'CHATGPT_CART_CHANGED',
    );
  }
  final preferenceSave = Future.wait([
    prefs.setString('selected_order_type', draft.orderType),
    prefs.setString('selected_bakery_location_id', draft.branch.id),
    prefs.setString('selected_bakery_location', draft.branch.displayLabel),
    prefs.setString(
      'selected_bakery_location_id_${draft.orderType}',
      draft.branch.id,
    ),
    prefs.setString(
      'selected_bakery_location_${draft.orderType}',
      draft.branch.displayLabel,
    ),
    prefs.setString('lastAppScreen', 'main'),
    prefs.remove('last_orderable_cart_type'),
    prefs.remove('last_orderable_cart_revision'),
    prefs.remove(
      customerPreferenceKey('checkout_preorder_fulfillment', session),
    ),
  ]);
  cart.replaceWithItems(
    draft.items.map((item) => item.cartItem),
    reconcileMenu: false,
  );
  await preferenceSave;
  await cart.persisted;
}

class ChatGptCartHandoff extends StatefulWidget {
  const ChatGptCartHandoff({
    required this.api,
    required this.child,
    required this.onImported,
    required this.onSelectOptions,
    this.enabled = kIsWeb,
    super.key,
  });

  final BulkaApiClient api;
  final Widget child;
  final ValueChanged<ChatGptCartDraft> onImported;
  final Future<void> Function(ChatGptCartDraft) onSelectOptions;
  final bool enabled;

  @override
  State<ChatGptCartHandoff> createState() => _ChatGptCartHandoffState();
}

class _ChatGptCartHandoffState extends State<ChatGptCartHandoff> {
  bool _active = false;
  bool _loading = false;

  @override
  void initState() {
    super.initState();
    if (widget.enabled) {
      clientRouteNotifier.addListener(_routeChanged);
      _captureRoute();
      WidgetsBinding.instance.addPostFrameCallback(
        (_) => unawaited(_openPending()),
      );
    }
  }

  @override
  void dispose() {
    if (widget.enabled) clientRouteNotifier.removeListener(_routeChanged);
    super.dispose();
  }

  void _captureRoute() =>
      PendingChatGptCartLink.capture(clientRouteNotifier.value);

  void _routeChanged() {
    _captureRoute();
    if (!_active) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) unawaited(_openPending());
      });
    }
  }

  Future<void> _openPending() async {
    if (!mounted || !widget.enabled || _active) return;
    final request = PendingChatGptCartLink.take();
    if (request == null) return;
    _active = true;
    final api = widget.api;
    bool current() =>
        mounted &&
        identical(api, widget.api) &&
        normalizedClientUri(clientRouteNotifier.value) == request.route;
    try {
      if (request.token == null) throw ApiException(_chatGptCartError(null));
      setState(() => _loading = true);
      final draft = await api.resolveChatGptCart(request.token!);
      if (!mounted || !current()) return;
      final cart = context.read<CartProvider>();
      await cart.restored;
      if (!mounted || !current()) return;
      setState(() => _loading = false);
      final reviewedRevision = cart.checkoutRevision;
      final accepted = await showDialog<bool>(
        context: context,
        animationStyle: BulkaMotion.reduced(context)
            ? AnimationStyle.noAnimation
            : null,
        builder: (_) => ChatGptCartReviewDialog(
          draft: draft,
          replacesCart: cart.items.isNotEmpty,
        ),
      );
      if (!current() || accepted != true) return;
      if (draft.requiresSelection) {
        await widget.onSelectOptions(draft);
        return;
      }
      setState(() => _loading = true);
      // Availability and prices may change while the review dialog is open.
      // Changed terms require a new explicit review rather than silent import.
      final latest = await api.resolveChatGptCart(request.token!);
      if (!mounted || !current()) return;
      if (latest.reviewIdentity != draft.reviewIdentity) {
        throw ApiException(
          _chatGptCartError('CHATGPT_CART_CHANGED'),
          code: 'CHATGPT_CART_CHANGED',
        );
      }
      await importReviewedChatGptCart(
        api: api,
        cart: cart,
        draft: latest,
        reviewedCartRevision: reviewedRevision,
      );
      if (current()) widget.onImported(latest);
    } catch (error) {
      if (mounted && current()) {
        setState(() => _loading = false);
        final message = error is ApiException
            ? error.message
            : _chatGptCartText(
                'Не удалось загрузить корзину. Попробуйте открыть ссылку ещё раз.',
                'Себетті жүктеу мүмкін болмады. Сілтемені қайта ашып көріңіз.',
                'Could not load the cart. Try opening the link again.',
              );
        await showDialog<void>(
          context: context,
          animationStyle: BulkaMotion.reduced(context)
              ? AnimationStyle.noAnimation
              : null,
          builder: (dialogContext) => BulkaActionDialog(
            title: Text(
              _chatGptCartText(
                'Корзина из ChatGPT',
                'ChatGPT-тегі себет',
                'Cart from ChatGPT',
              ),
            ),
            content: Text(message),
            actions: [
              FilledButton(
                onPressed: () => Navigator.pop(dialogContext),
                child: Text(_chatGptCartText('Понятно', 'Түсінікті', 'Got it')),
              ),
            ],
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _loading = false);
        // Keep old-branch menu responses suppressed until the shell's new
        // selection revision has rebuilt and invalidated their old scope.
        WidgetsBinding.instance.addPostFrameCallback((_) {
          PendingChatGptCartLink.finish();
          _active = false;
          if (mounted) unawaited(_openPending());
        });
      } else {
        PendingChatGptCartLink.finish();
        _active = false;
      }
    }
  }

  @override
  Widget build(BuildContext context) => Stack(
    children: [
      widget.child,
      if (_loading)
        Positioned(
          top: 0,
          left: 0,
          right: 0,
          child: SafeArea(
            bottom: false,
            child: Semantics(
              label: _chatGptCartText(
                'Загружаем корзину',
                'Себет жүктелуде',
                'Loading cart',
              ),
              liveRegion: true,
              child: const LinearProgressIndicator(
                minHeight: 3,
                color: _bulkaBrown,
              ),
            ),
          ),
        ),
    ],
  );
}

class ChatGptCartReviewDialog extends StatelessWidget {
  const ChatGptCartReviewDialog({
    required this.draft,
    required this.replacesCart,
    super.key,
  });
  final ChatGptCartDraft draft;
  final bool replacesCart;

  @override
  Widget build(BuildContext context) => BulkaActionDialog(
    title: Text(
      _chatGptCartText(
        'Корзина из ChatGPT',
        'ChatGPT-тегі себет',
        'Cart from ChatGPT',
      ),
    ),
    content: Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          draft.branch.displayLabel,
          style: const TextStyle(fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: 4),
        Text(
          '${draft.branch.city} · ${_orderTypeFromWire(draft.orderType).label}',
        ),
        const SizedBox(height: 20),
        for (final item in draft.items)
          Padding(
            padding: const EdgeInsets.only(bottom: 16),
            child: _ChatGptCartReviewLine(item: item),
          ),
        if (!draft.requiresSelection) ...[
          Text(
            _chatGptCartText(
              'Товары: ${draft.itemSubtotal} ₸',
              'Тауарлар: ${draft.itemSubtotal} ₸',
              'Items: ${draft.itemSubtotal} ₸',
            ),
            style: const TextStyle(fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 8),
          Text(
            _chatGptCartText(
              'Итог с доставкой и скидками — при оформлении.',
              'Жеткізу мен жеңілдіктер қосылған қорытынды — рәсімдеу кезінде.',
              'Delivery and discounts are calculated at checkout.',
            ),
          ),
        ] else
          Text(
            _chatGptCartText(
              'Выберите обязательные варианты товара в каталоге, чтобы собрать корзину.',
              'Себетті жинау үшін каталогтан тауардың міндетті нұсқаларын таңдаңыз.',
              'Choose the required product options in the catalog to build the cart.',
            ),
          ),
        if (replacesCart && !draft.requiresSelection) ...[
          const SizedBox(height: 12),
          Text(
            _chatGptCartText(
              'Текущая корзина будет заменена.',
              'Қазіргі себет ауыстырылады.',
              'Your current cart will be replaced.',
            ),
          ),
        ],
      ],
    ),
    actions: [
      FilledButton(
        key: const ValueKey('chatgpt-cart-confirm'),
        onPressed: () => Navigator.pop(context, true),
        child: Text(
          draft.requiresSelection
              ? _chatGptCartText(
                  'Выбрать варианты',
                  'Нұсқаларды таңдау',
                  'Choose options',
                )
              : replacesCart
              ? _chatGptCartText(
                  'Заменить корзину',
                  'Себетті ауыстыру',
                  'Replace cart',
                )
              : _chatGptCartText(
                  'Добавить в корзину',
                  'Себетке қосу',
                  'Add to cart',
                ),
        ),
      ),
      TextButton(
        key: const ValueKey('chatgpt-cart-cancel'),
        onPressed: () => Navigator.pop(context, false),
        child: Text('cancel_btn'.tr),
      ),
    ],
  );
}

class _ChatGptCartReviewLine extends StatelessWidget {
  const _ChatGptCartReviewLine({required this.item});
  final ChatGptCartDraftItem item;

  @override
  Widget build(BuildContext context) {
    final cartItem = item.cartItem;
    final selection = [
      for (final key in ['weight', 'filling', 'design'])
        if (_chatGptOptionTitle(
          _asMap(_asMap(item.selectedOptions['configuration'])[key])['title'],
        ).isNotEmpty)
          _chatGptOptionTitle(
            _asMap(_asMap(item.selectedOptions['configuration'])[key])['title'],
          ),
      for (final modifier
          in (item.selectedOptions['modifiers'] is List
              ? item.selectedOptions['modifiers'] as List
              : const []))
        for (final option
            in (_asMap(modifier)['options'] is List
                ? _asMap(modifier)['options'] as List
                : const []))
          if (_chatGptOptionTitle(_asMap(option)['title']).isNotEmpty)
            _chatGptOptionTitle(_asMap(option)['title']),
    ].join(', ');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          cartItem.name,
          style: const TextStyle(fontWeight: FontWeight.w600),
        ),
        if (selection.isNotEmpty) Text(selection),
        const SizedBox(height: 3),
        Text(
          '${productQuantityText(cartItem.quantity)} ${cartItem.unit} · ${cartItem.total} ₸',
        ),
        if (item.requiresSelection)
          Text(
            _chatGptCartText(
              'Нужно выбрать варианты',
              'Нұсқаларды таңдау керек',
              'Options are required',
            ),
          ),
      ],
    );
  }
}
