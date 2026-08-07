import type {
  TaplinkBlock,
  TaplinkDocument,
  TaplinkLinkBlock,
  TaplinkLocale,
  TaplinkSectionBlock,
  TaplinkTarget,
} from '../../lib/api-types';

export const TAPLINK_LOCALES: TaplinkLocale[] = ['kk', 'ru'];

const uuidFallback = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });

export const createTaplinkId = () =>
  typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : uuidFallback();

export function createTaplinkBlock(type: TaplinkBlock['type']): TaplinkBlock {
  if (type === 'section') {
    return {
      id: createTaplinkId(),
      type,
      enabled: true,
      labels: { kk: 'Жаңа бөлім', ru: 'Новый раздел' },
    } satisfies TaplinkSectionBlock;
  }

  return {
    id: createTaplinkId(),
    type,
    enabled: true,
    style: 'standard',
    labels: { kk: 'Жаңа сілтеме', ru: 'Новая ссылка' },
    subtitles: { kk: '', ru: '' },
    ariaLabels: { kk: '', ru: '' },
    icon: 'globe',
    target: { type: 'url', value: 'https://bulka.com.kz' },
  } satisfies TaplinkLinkBlock;
}

export function duplicateTaplinkBlock(block: TaplinkBlock): TaplinkBlock {
  return { ...structuredClone(block), id: createTaplinkId() };
}

export function moveTaplinkBlock(
  blocks: TaplinkBlock[],
  id: string,
  direction: -1 | 1,
): TaplinkBlock[] {
  const index = blocks.findIndex((block) => block.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= blocks.length) return blocks;
  const reordered = [...blocks];
  [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
  return reordered;
}

export function reorderTaplinkBlock(
  blocks: TaplinkBlock[],
  sourceId: string,
  targetId: string,
): TaplinkBlock[] {
  const sourceIndex = blocks.findIndex((block) => block.id === sourceId);
  const targetIndex = blocks.findIndex((block) => block.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return blocks;
  const reordered = [...blocks];
  const [source] = reordered.splice(sourceIndex, 1);
  reordered.splice(targetIndex, 0, source);
  return reordered;
}

export const taplinkFingerprint = (document: TaplinkDocument) => JSON.stringify(document);

export function taplinkTargetHref(target: TaplinkTarget) {
  const value = target.value.trim();
  if (target.type === 'whatsapp') return `https://wa.me/${value.replace(/\D/g, '')}`;
  if (target.type === 'phone') return `tel:${value}`;
  if (target.type === 'email') return `mailto:${value}`;
  return value;
}

export const taplinkBlockName = (block: TaplinkBlock, locale: TaplinkLocale) =>
  block.labels[locale] || block.labels.ru || block.labels.kk;

export function withTaplinkBlocks(
  document: TaplinkDocument,
  blocks: TaplinkBlock[],
): TaplinkDocument {
  return { ...document, blocks };
}
