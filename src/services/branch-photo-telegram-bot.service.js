const { randomUUID } = require('node:crypto');
const { createTelegramApi } = require('./branch-photo-telegram-api.service');

const PRIVATE_ID = /^[1-9]\d{0,19}$/;
const NICKNAME = /^@?([a-z0-9_]{5,32})$/i;
const OWNER_ONLY = new Set(['admin', 'removeadmin', 'admins', 'time']);
function parseCommand(text) {
  const match = /^\/([a-z]+)(?:@[a-z0-9_]+)?(?:\s+([\s\S]*))?$/i.exec(text?.trim() || '');
  return { command: match?.[1].toLowerCase() || 'help', argument: match?.[2]?.trim() || '' };
}
function privateIdentity(update) {
  const message = update?.message;
  if (message?.chat?.type !== 'private' || message.from?.is_bot) return null;
  const id = String(message.from?.id ?? '');
  if (!PRIVATE_ID.test(id) || id !== String(message.chat.id)) return null;
  if (typeof message.from.id === 'number' && !Number.isSafeInteger(message.from.id)) return null;
  if (typeof message.chat.id === 'number' && !Number.isSafeInteger(message.chat.id)) return null;
  return { id, chatId: id, username: message.from.username || '', private: true };
}
function wait(milliseconds, signal) {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, milliseconds);
    signal?.addEventListener('abort', done, { once: true });
  });
}
function splitLines(text) {
  const parts = [];
  let part = '';
  for (const line of text.split('\n')) {
    if (part.length + line.length + 1 > 3900) {
      parts.push(part);
      part = '';
    }
    part += `${part ? '\n' : ''}${line}`;
  }
  if (part) parts.push(part);
  return parts;
}
function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function createBot({
  store,
  api = createTelegramApi(),
  digest,
  ownerUsername = process.env.PHOTO_REPORT_TELEGRAM_OWNER_USERNAME || 'amandyk7292',
  ownerUserId = process.env.PHOTO_REPORT_TELEGRAM_OWNER_ID || '',
  db,
  now = () => new Date(),
  sleep = wait,
  leaseId = randomUUID(),
  logger = console,
} = {}) {
  if (!store || !digest) throw new Error('Photo report Telegram dependencies are not configured.');
  if (ownerUserId && !PRIVATE_ID.test(String(ownerUserId)))
    throw new Error('Invalid photo report Telegram owner ID.');
  let running = false;
  let stopped = false;
  let leased = false;
  let offset = 0;
  let webhookReady = false;
  let busy = false;
  let failures = 0;
  let loop;
  const stopController = new AbortController();
  const options = (updateId) => ({ db, now: now(), leaseId, updateId });
  const backoff = (result = {}) => {
    failures = Math.min(failures + 1, 6);
    return {
      status: 'backoff',
      waitMs: Math.max(1000 * 2 ** failures, Number(result.retryAfterSeconds || 0) * 1000),
    };
  };
  async function ensureLease() {
    if (leased && (await store.renewPollingLease(leaseId, options()))) return true;
    leased = false;
    const saved = await store.acquirePollingLease(leaseId, options());
    if (saved === null) return false;
    if (!Number.isSafeInteger(saved) || saved < 0)
      throw new Error('Invalid Telegram polling cursor.');
    offset = saved;
    leased = true;
    return true;
  }
  async function replies(update, user) {
    const { command, argument } = parseCommand(update.message.text);
    const allowed = user.role === 'owner' || user.role === 'admin';
    if (OWNER_ONLY.has(command) && user.role !== 'owner')
      return ['Команда доступна только владельцу.'];
    if (command === 'report') {
      if (!allowed) return ['Доступ к фотоотчётам выдаёт владелец.'];
      const date = argument || digest.previousCalendarDate(now());
      if (!validDate(date) || date > digest.localClock(now()).date)
        return ['Укажите дату: /report YYYY-MM-DD, не позднее сегодняшней.'];
      return {
        parts: (await digest.generateDigest(date, { db, now: now() })).parts,
        requiresReportAccess: true,
      };
    }
    if (command === 'admin' || command === 'removeadmin') {
      const nickname = NICKNAME.exec(argument)?.[1]?.toLowerCase();
      if (!nickname) return [`Формат: /${command} @username`];
      if (command === 'admin') {
        const added = await store.addAdmin(user.userId, nickname, options(update.update_id));
        if (added.role === 'owner') return ['Это владелец бота.'];
        return [
          added.status === 'pending'
            ? `@${nickname} добавлен. Для подключения нужно открыть @bulkakz_bot и отправить /start.`
            : `@${nickname} подключён к фотоотчётам.`,
        ];
      }
      const removed = await store.removeAdmin(user.userId, nickname, options(update.update_id));
      return [
        removed.removed
          ? `Доступ @${nickname} отключён.`
          : `@${nickname} не найден среди администраторов.`,
      ];
    }
    if (command === 'admins') {
      const admins = await store.listAdmins(user.userId, options(update.update_id));
      return splitLines(
        [
          'Доступ к фотоотчётам:',
          ...admins.map((admin) => {
            const label = admin.username ? `@${admin.username}` : `ID ${admin.userId}`;
            const state =
              admin.role === 'owner'
                ? 'владелец'
                : admin.status === 'pending'
                  ? 'ждёт /start'
                  : admin.status === 'disabled'
                    ? 'отключён'
                    : 'подключён';
            return `${label} — ${state}`;
          }),
        ].join('\n'),
      );
    }
    if (command === 'time') {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(argument))
        return ['Формат: /time HH:mm, время Казахстана.'];
      const settings = await store.setSendTime(user.userId, argument, options(update.update_id));
      return [`Сводка ежедневно в ${settings.sendTime} по времени Казахстана.`];
    }
    if (!allowed)
      return [
        'Фотоотчёты Bulka.\nДля доступа попросите владельца добавить ваш @username, затем отправьте /start.',
      ];
    const settings = await store.getSettings(options());
    return [
      `Фотоотчёты Bulka подключены.\nСводка ежедневно в ${settings.sendTime} (Казахстан).\n/report — за вчера\n/report YYYY-MM-DD — за дату${user.role === 'owner' ? '\n/admin @username — добавить\n/removeadmin @username — убрать\n/admins — список\n/time HH:mm — время' : ''}`,
    ];
  }
  async function finish(updateId) {
    if (!(await store.completeBotUpdate(updateId, leaseId, options(updateId))))
      throw new Error('Photo report Telegram polling lease lost.');
    offset = Math.max(offset, updateId + 1);
  }
  async function handleUpdate(update, signal = stopController.signal) {
    const id = update?.update_id;
    if (!Number.isSafeInteger(id) || id < 0) throw new Error('Invalid Telegram update.');
    if (signal.aborted || !(await ensureLease())) return { status: 'stopped' };
    const claim = await store.claimBotUpdate(id, leaseId, options(id));
    if (claim === null) return backoff();
    if (claim === 'completed' || claim === 'reply_attempted') {
      await finish(id);
      return { status: 'processed' };
    }
    const identity = privateIdentity(update);
    if (!identity) {
      await finish(id);
      return { status: 'processed' };
    }
    const user = await store.observeUser(identity, {
      ...options(id),
      ownerUsername,
      ownerUserId,
    });
    if (claim === 'claimed') {
      let prepared;
      try {
        prepared = await replies(update, user);
      } catch (error) {
        if (
          ![
            'PHOTO_REPORT_TELEGRAM_OWNER_REQUIRED',
            'PHOTO_REPORT_TELEGRAM_OWNER_PROTECTED',
            'PHOTO_REPORT_TELEGRAM_INVALID',
          ].includes(error?.code)
        )
          throw error;
        prepared = [
          error.code === 'PHOTO_REPORT_TELEGRAM_OWNER_PROTECTED'
            ? 'Владельца бота отключить нельзя.'
            : 'Проверьте команду и права доступа.',
        ];
      }
      const parts = Array.isArray(prepared) ? prepared : prepared.parts;
      if (
        !Array.isArray(parts) ||
        !parts.length ||
        parts.length > 20 ||
        parts.some((text) => typeof text !== 'string' || !text.length || text.length > 4096)
      )
        throw new Error('Invalid photo report Telegram reply.');
      if (
        !(await store.prepareBotReply(id, leaseId, parts, {
          ...options(id),
          requiresReportAccess: prepared.requiresReportAccess === true,
        }))
      )
        throw new Error('Photo report Telegram reply preparation failed.');
    }
    let reply = await store.getBotReply(id, leaseId, options(id));
    if (!reply) throw new Error('Photo report Telegram reply not found.');
    if (reply.notBefore && Date.parse(reply.notBefore) > now().getTime())
      return {
        status: 'backoff',
        waitMs: Math.max(1000, Date.parse(reply.notBefore) - now().getTime()),
      };
    for (let part = reply.partIndex || 0; part < reply.parts.length; part++) {
      if (reply.requiresReportAccess) {
        const current = await store.observeUser(identity, {
          ...options(id),
          ownerUsername,
          ownerUserId,
        });
        if (!['owner', 'admin'].includes(current.role)) {
          await finish(id);
          return { status: 'processed' };
        }
      }
      if (signal.aborted || !(await store.markBotReplyAttempted(id, leaseId, options(id))))
        return { status: 'stopped' };
      const sent = await api.sendMessage(identity.chatId, reply.parts[part], { signal });
      if (sent.status === 'retryable') {
        if (
          !(await store.markBotReplyRetryable(id, leaseId, {
            ...options(id),
            retryAfter: sent.retryAfterSeconds || 5,
          }))
        )
          throw new Error('Photo report Telegram retry persistence failed.');
        return backoff(sent);
      }
      if (sent.status === 'cancelled') return { status: 'stopped' };
      if (sent.status !== 'sent') {
        await finish(id);
        return { status: 'processed' };
      }
      if (!(await store.advanceBotReplyPart(id, leaseId, options(id))))
        throw new Error('Photo report Telegram reply progress failed.');
    }
    await finish(id);
    return { status: 'processed' };
  }
  async function pollOnce() {
    if (stopped) return { status: 'stopped' };
    if (busy) return { status: 'idle', waitMs: 1000 };
    busy = true;
    const controller = new AbortController();
    const abort = () => controller.abort();
    stopController.signal.addEventListener('abort', abort, { once: true });
    let renewing = false;
    let heartbeat;
    try {
      if (!(await ensureLease())) return { status: 'idle', waitMs: 5000 };
      heartbeat = setInterval(() => {
        if (renewing) return;
        renewing = true;
        void store
          .renewPollingLease(leaseId, options())
          .then((valid) => {
            if (!valid) {
              leased = false;
              abort();
            }
          })
          .catch(() => {
            leased = false;
            abort();
          })
          .finally(() => {
            renewing = false;
          });
      }, 20000);
      if (!webhookReady) {
        const removed = await api.deleteWebhook({ signal: controller.signal });
        if (removed.status !== 'ok') return backoff(removed);
        webhookReady = true;
      }
      const result = await api.getUpdates({
        offset,
        timeoutSeconds: 25,
        signal: controller.signal,
      });
      if (result.status !== 'ok')
        return controller.signal.aborted ? { status: 'stopped' } : backoff(result);
      const updates = [...result.updates].sort((a, b) => a.update_id - b.update_id);
      for (const update of updates) {
        if (update.update_id < offset) continue;
        const handled = await handleUpdate(update, controller.signal);
        if (handled.status !== 'processed') return handled;
      }
      failures = 0;
      return { status: 'processed', waitMs: updates.length ? 100 : 1000 };
    } catch {
      logger.warn?.('Photo report Telegram polling is temporarily unavailable.');
      return backoff();
    } finally {
      clearInterval(heartbeat);
      stopController.signal.removeEventListener('abort', abort);
      busy = false;
    }
  }
  function start() {
    if (running || stopped) return loop;
    running = true;
    loop = (async () => {
      while (running) {
        const result = await pollOnce();
        if (running) await sleep(Math.min(result.waitMs || 1000, 60000), stopController.signal);
      }
    })();
    return loop;
  }
  async function stop() {
    running = false;
    stopped = true;
    stopController.abort();
    if (loop) await loop;
    if (leased) await store.releasePollingLease(leaseId, options()).catch(() => {});
    leased = false;
  }
  return { start, stop, pollOnce, handleUpdate };
}
let singleton;
function startPolling(options = {}) {
  if (singleton) return singleton;
  const api = options.api || createTelegramApi();
  if (!api.configured) return null;
  singleton = createBot({
    store: require('./branch-photo-telegram-store.service'),
    digest: require('./branch-photo-digest.service'),
    ...options,
    api,
  });
  void singleton.start();
  return singleton;
}
async function stopPolling() {
  const current = singleton;
  singleton = null;
  if (current) await current.stop();
}
module.exports = { createBot, startPolling, stopPolling, privateIdentity };
