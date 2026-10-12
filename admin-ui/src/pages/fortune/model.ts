export type Text = (ru: string, kk: string) => string;
export type PrizeKind = 'gift' | 'bonus' | 'none';
export type CampaignStatus = 'draft' | 'active' | 'paused';
export type Prize = {
  id: string;
  label: string;
  color: string;
  kind: PrizeKind;
  bonusAmount: number | null;
  weight: number;
  stockLimit: number | null;
  validityDays: number;
  active: boolean;
  issuedCount: number;
};
export type Branch = { id: string; name: string; city: string; address: string; active: boolean };
export type Campaign = {
  id: string;
  title: string;
  status: CampaignStatus;
  branchIds: string[];
  startsAt: string | null;
  endsAt: string | null;
  minReceiptAmount: number;
  maxReceiptAgeHours: number;
  version: number;
  prizes: Prize[];
  createdAt: string;
  updatedAt: string;
};
export type CampaignInput = Omit<
  Campaign,
  'id' | 'version' | 'createdAt' | 'updatedAt' | 'prizes'
> & {
  expectedVersion?: number;
  prizes: Omit<Prize, 'issuedCount'>[];
};
export type Winner = {
  id: string;
  campaignId: string;
  branchId: string;
  branchName?: string;
  prizeLabel: string;
  prizeKind: PrizeKind;
  status: 'pending' | 'claimed' | 'redeemed' | 'expired';
  wonAt: string;
  expiresAt: string;
  claimedAt?: string | null;
  redeemedAt?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  receiptNumber?: string | null;
  receiptTotal?: number;
};
export type Dashboard = { campaigns: Campaign[]; branches: Branch[] };
export type Winners = { items: Winner[]; total: number; page: number };
export type Voucher = Pick<
  Winner,
  | 'id'
  | 'branchId'
  | 'branchName'
  | 'prizeLabel'
  | 'prizeKind'
  | 'status'
  | 'wonAt'
  | 'expiresAt'
  | 'customerName'
  | 'redeemedAt'
>;

export function defaultPrize(kind: PrizeKind, label: string, color: string, weight: number): Prize {
  return {
    id: crypto.randomUUID(),
    label,
    color,
    kind,
    weight,
    bonusAmount: kind === 'bonus' ? 100 : null,
    stockLimit: null,
    validityDays: 7,
    active: true,
    issuedCount: 0,
  };
}
export function newCampaign(text: Text): Campaign {
  return {
    id: '',
    title: '',
    status: 'draft',
    branchIds: [],
    startsAt: null,
    endsAt: null,
    minReceiptAmount: 0,
    maxReceiptAgeHours: 24,
    version: 0,
    createdAt: '',
    updatedAt: '',
    prizes: [
      defaultPrize('gift', text('Подарок от Bulka', 'Bulka сыйлығы'), '#ffbf28', 40),
      defaultPrize('bonus', text('100 бонусов', '100 бонус'), '#83c2a2', 30),
      defaultPrize('none', text('Удача в следующий раз', 'Келесі жолы сәттілік'), '#f5e4c3', 30),
    ],
  };
}
export function campaignInput(campaign: Campaign): CampaignInput {
  return {
    title: campaign.title.trim(),
    status: campaign.status,
    branchIds: campaign.branchIds,
    startsAt: campaign.startsAt,
    endsAt: campaign.endsAt,
    minReceiptAmount: campaign.minReceiptAmount,
    maxReceiptAgeHours: campaign.maxReceiptAgeHours,
    ...(campaign.id ? { expectedVersion: campaign.version } : {}),
    prizes: campaign.prizes.map(({ issuedCount: _issuedCount, ...prize }) => ({
      ...prize,
      label: prize.label.trim(),
      bonusAmount: prize.kind === 'bonus' ? prize.bonusAmount : null,
      stockLimit: prize.kind === 'none' ? null : prize.stockLimit,
    })),
  };
}
export function validationMessage(campaign: Campaign, text: Text) {
  if (!campaign.title.trim()) return text('Укажите название акции.', 'Акция атауын енгізіңіз.');
  if (!campaign.branchIds.length)
    return text('Выберите хотя бы один филиал.', 'Кемінде бір филиалды таңдаңыз.');
  if (campaign.prizes.length < 2)
    return text('Добавьте хотя бы два сектора.', 'Кемінде екі секторды қосыңыз.');
  if (campaign.prizes.some((prize) => !prize.label.trim()))
    return text('Укажите название каждого приза.', 'Әр сыйлықтың атауын енгізіңіз.');
  if (
    campaign.prizes.some(
      (prize) =>
        prize.kind === 'bonus' &&
        (!Number.isInteger(prize.bonusAmount) || Number(prize.bonusAmount) <= 0),
    )
  )
    return text('Укажите сумму бонусного приза.', 'Бонус сыйлығының сомасын енгізіңіз.');
  if (
    campaign.prizes.some(
      (prize) => prize.stockLimit !== null && prize.stockLimit < prize.issuedCount,
    )
  )
    return text(
      'Лимит не может быть меньше уже выданных призов.',
      'Шек берілген сыйлықтардан аз болмауы керек.',
    );
  if (
    campaign.startsAt &&
    campaign.endsAt &&
    Date.parse(campaign.endsAt) <= Date.parse(campaign.startsAt)
  )
    return text(
      'Дата окончания должна быть позже начала.',
      'Аяқталу күні басталу күнінен кейін болуы керек.',
    );
  if (campaign.status === 'active') {
    const active = campaign.prizes.filter((prize) => prize.active);
    if (active.length < 2)
      return text('Включите хотя бы два сектора.', 'Кемінде екі секторды қосыңыз.');
    if (active.reduce((sum, prize) => sum + prize.weight, 0) !== 100)
      return text(
        'Для запуска сумма вероятностей должна быть 100%.',
        'Іске қосу үшін ықтималдықтар қосындысы 100% болуы керек.',
      );
    if (!active.some((prize) => prize.kind === 'none' && prize.weight > 0))
      return text(
        'Добавьте сектор без приза с вероятностью больше 0%.',
        'Сыйлықсыз секторды 0%-дан жоғары ықтималдықпен қосыңыз.',
      );
  }
  return '';
}
