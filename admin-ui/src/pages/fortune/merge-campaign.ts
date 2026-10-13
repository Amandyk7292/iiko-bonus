import { campaignInput, type Campaign, type Prize, type Text } from './model';

export type CampaignMerge = {
  mine: Campaign;
  theirs: Campaign;
  conflicts: string[];
  details?: { label: string; mine: string; theirs: string }[];
  issue?: string;
};

const campaignFields = [
  ['title', 'Название акции', 'Акция атауы'],
  ['status', 'Статус', 'Мәртебе'],
  ['startsAt', 'Начало акции', 'Акцияның басталуы'],
  ['endsAt', 'Окончание акции', 'Акцияның аяқталуы'],
  ['minReceiptAmount', 'Минимальная сумма чека', 'Чектің ең аз сомасы'],
  ['maxReceiptAgeHours', 'Максимальный возраст чека', 'Чектің ең ұзақ мерзімі'],
] as const;
const prizeFields = [
  ['label', 'Название приза', 'Сыйлық атауы'],
  ['color', 'Цвет сектора', 'Сектор түсі'],
  ['kind', 'Тип приза', 'Сыйлық түрі'],
  ['bonusAmount', 'Сумма бонусов', 'Бонус сомасы'],
  ['weight', 'Вероятность', 'Ықтималдық'],
  ['stockLimit', 'Всего призов', 'Сыйлық саны'],
  ['validityDays', 'Срок получения', 'Алу мерзімі'],
  ['active', 'Включён', 'Қосулы'],
] as const;

function equal(first: unknown, second: unknown) {
  return JSON.stringify(first) === JSON.stringify(second);
}
function choose<T>(
  base: T,
  draft: T,
  latest: T,
  same: (first: T, second: T) => boolean = equal,
): [T, T] {
  if (same(draft, base)) return [latest, latest];
  if (same(latest, base) || same(draft, latest)) return [draft, draft];
  return [draft, latest];
}
function normalize(campaign: Campaign, latest: Campaign): Campaign {
  const { expectedVersion: _version, ...input } = campaignInput(campaign);
  const issued = new Map(latest.prizes.map((prize) => [prize.id, prize.issuedCount]));
  return {
    ...latest,
    ...input,
    branchIds: [...new Set(input.branchIds)],
    prizes: input.prizes.map((prize) => ({ ...prize, issuedCount: issued.get(prize.id) ?? 0 })),
  };
}
function mergeBranches(base: string[], draft: string[], latest: string[]) {
  const original = new Set(base),
    local = new Set(draft),
    merged = new Set(latest);
  for (const id of new Set([...base, ...draft])) {
    if (original.has(id) !== local.has(id)) {
      if (local.has(id)) merged.add(id);
      else merged.delete(id);
    }
  }
  return [...new Set([...latest, ...draft])].filter((id) => merged.has(id));
}
function prizeSignature(prizes: Prize[]) {
  return prizes.map((prize) => [prize.id, ...prizeFields.map(([field]) => prize[field])]);
}
function formatValue(value: unknown, field: string, text: Text): string {
  if (value === null || value === undefined)
    return field === 'stockLimit'
      ? text('Без лимита', 'Шектеусіз')
      : text('Не задано', 'Белгіленбеген');
  if (typeof value === 'boolean') return value ? text('Да', 'Иә') : text('Нет', 'Жоқ');
  const labels: Record<string, Record<string, [string, string]>> = {
    status: {
      active: ['Активна', 'Белсенді'],
      paused: ['Приостановлена', 'Кідіртілген'],
      draft: ['Черновик', 'Жоба'],
    },
    kind: {
      gift: ['Подарок', 'Сыйлық'],
      bonus: ['Бонусы', 'Бонустар'],
      none: ['Без приза', 'Сыйлықсыз'],
    },
  };
  const label = labels[field]?.[String(value)];
  if (label) return text(...label);
  if (typeof value === 'number') return value.toLocaleString(text('ru-RU', 'kk-KZ'));
  if (typeof value === 'string' && (field === 'startsAt' || field === 'endsAt')) {
    const date = new Date(value);
    if (Number.isFinite(date.getTime())) return date.toLocaleString(text('ru-RU', 'kk-KZ'));
  }
  return String(value).trim() || text('Не задано', 'Белгіленбеген');
}

/** Merge writable values only; neither preference discards unrelated changes. */
export function mergeCampaign(
  base: Campaign,
  draft: Campaign,
  latest: Campaign,
  text: Text,
): CampaignMerge {
  const original = normalize(base, latest),
    local = normalize(draft, latest);
  const current = normalize(latest, latest);
  function mergeFields<T extends object>(
    previous: T,
    edited: T,
    remote: T,
    fields: readonly (readonly [keyof T & string, string, string])[],
  ): [T, T] {
    const candidates: [T, T] = [{ ...remote }, { ...remote }];
    for (const [field] of fields) {
      const values = choose(previous[field], edited[field], remote[field]);
      candidates.forEach((candidate, index) => (candidate[field] = values[index]));
    }
    return candidates;
  }
  let [mine, theirs] = mergeFields(original, local, current, campaignFields);
  mine.branchIds = mergeBranches(original.branchIds, local.branchIds, current.branchIds);
  theirs.branchIds = [...mine.branchIds];

  const orders = [original, local, current].map((campaign) =>
    campaign.prizes.map((prize) => prize.id),
  );
  const unique = orders.map((order) => [...new Set(order)].sort());
  const granular = orders.every(
    (order, index) => order.length === unique[index].length && equal(unique[0], unique[index]),
  );
  if (granular) {
    const originalById = new Map(original.prizes.map((prize) => [prize.id, prize]));
    const localById = new Map(local.prizes.map((prize) => [prize.id, prize]));
    const merged = new Map<string, [Prize, Prize]>();
    for (const prize of current.prizes) {
      merged.set(
        prize.id,
        mergeFields(originalById.get(prize.id)!, localById.get(prize.id)!, prize, prizeFields),
      );
    }
    const [myOrder, theirOrder] = choose(orders[0], orders[1], orders[2]);
    mine.prizes = myOrder.map((id) => merged.get(id)![0]);
    theirs.prizes = theirOrder.map((id) => merged.get(id)![1]);
  } else {
    // Add/delete races require an explicit list choice; no orphaned prize edit
    // or remotely added sector is silently dropped by a granular merge.
    const lists = choose(original.prizes, local.prizes, current.prizes, (first, second) =>
      equal(prizeSignature(first), prizeSignature(second)),
    );
    [mine.prizes, theirs.prizes] = lists.map((list) => list.map((prize) => ({ ...prize })));
  }

  let issue: string | undefined;
  for (const candidate of [mine, theirs]) {
    for (const [index, prize] of current.prizes.entries()) {
      if (prize.issuedCount <= 0 || candidate.prizes.some((item) => item.id === prize.id)) continue;
      const nextIds = new Set(current.prizes.slice(index + 1).map((item) => item.id));
      const position = candidate.prizes.findIndex((item) => nextIds.has(item.id));
      candidate.prizes.splice(position < 0 ? candidate.prizes.length : position, 0, { ...prize });
      issue = text(
        'Выданный приз восстановлен. Проверьте призы и сохраните настройки снова.',
        'Берілген сыйлық қалпына келтірілді. Сыйлықтарды тексеріп, баптауларды қайта сақтаңыз.',
      );
    }
  }
  mine = normalize(mine, latest);
  theirs = normalize(theirs, latest);
  // A type switch can make a conflicting bonus/limit field non-writable.
  // Report only overlaps that still produce different normalized candidates.
  const details: NonNullable<CampaignMerge['details']> = [];
  function compareFields<T>(
    first: T,
    second: T,
    fields: readonly (readonly [keyof T & string, string, string])[],
    index?: number,
  ) {
    for (const [field, ru, kk] of fields) {
      if (!equal(first[field], second[field]))
        details.push({
          label:
            index === undefined
              ? text(ru, kk)
              : text(`Приз ${index + 1}: ${ru}`, `${index + 1} сыйлық: ${kk}`),
          mine: formatValue(first[field], field, text),
          theirs: formatValue(second[field], field, text),
        });
    }
  }
  compareFields(mine, theirs, campaignFields);
  if (granular) {
    current.prizes.forEach((prize, index) =>
      compareFields(
        mine.prizes.find((item) => item.id === prize.id)!,
        theirs.prizes.find((item) => item.id === prize.id)!,
        prizeFields,
        index,
      ),
    );
  }
  const values = [mine, theirs].map((candidate) =>
    granular ? candidate.prizes.map((prize) => prize.id) : prizeSignature(candidate.prizes),
  );
  if (!equal(values[0], values[1])) {
    const displays = [mine, theirs].map((candidate) =>
      candidate.prizes.map((prize) => prize.label).join(granular ? ' → ' : ', '),
    );
    details.push({
      label: granular ? text('Порядок призов', 'Сыйлықтардың реті') : text('Призы', 'Сыйлықтар'),
      mine: displays[0],
      theirs: displays[1],
    });
  }
  const conflicts = [...new Set(details.map(({ label }) => label))];
  return {
    mine,
    theirs,
    conflicts,
    ...(details.length ? { details } : {}),
    ...(issue ? { issue } : {}),
  };
}
