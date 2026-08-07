import { describe, expect, it } from 'vitest';
import type { TaplinkDocument, TaplinkLinkBlock } from '../../lib/api-types';
import {
  createTaplinkBlock,
  duplicateTaplinkBlock,
  moveTaplinkBlock,
  reorderTaplinkBlock,
  taplinkFingerprint,
  taplinkTargetHref,
} from './taplink.helpers';

describe('taplink builder helpers', () => {
  it('creates valid, localized blocks with stable safe defaults', () => {
    const section = createTaplinkBlock('section');
    const link = createTaplinkBlock('link') as TaplinkLinkBlock;

    expect(section.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(section.labels).toEqual({ kk: 'Жаңа бөлім', ru: 'Новый раздел' });
    expect(link.target).toEqual({ type: 'url', value: 'https://bulka.com.kz' });
    expect(link.labels.kk).toBeTruthy();
    expect(link.labels.ru).toBeTruthy();
  });

  it('duplicates and reorders without mutating the original blocks', () => {
    const first = createTaplinkBlock('section');
    const second = createTaplinkBlock('link');
    const third = duplicateTaplinkBlock(second);
    const original = [first, second, third];

    expect(third.id).not.toBe(second.id);
    expect(moveTaplinkBlock(original, second.id, -1).map((block) => block.id)).toEqual([
      second.id,
      first.id,
      third.id,
    ]);
    expect(reorderTaplinkBlock(original, first.id, third.id).map((block) => block.id)).toEqual([
      second.id,
      third.id,
      first.id,
    ]);
    expect(original.map((block) => block.id)).toEqual([first.id, second.id, third.id]);
  });

  it('builds safe preview hrefs for every structured target', () => {
    expect(taplinkTargetHref({ type: 'whatsapp', value: '+7 (701) 277-22-33' })).toBe(
      'https://wa.me/77012772233',
    );
    expect(taplinkTargetHref({ type: 'phone', value: '+7 701 277 22 33' })).toBe(
      'tel:+7 701 277 22 33',
    );
    expect(taplinkTargetHref({ type: 'email', value: 'hello@bulka.kz' })).toBe(
      'mailto:hello@bulka.kz',
    );
    expect(taplinkTargetHref({ type: 'url', value: 'https://bulka.com.kz' })).toBe(
      'https://bulka.com.kz',
    );
  });

  it('fingerprints all draft content', () => {
    const document = {
      schemaVersion: 1,
      defaultLocale: 'kk',
      enabledLocales: ['kk', 'ru'],
      profile: {
        title: { kk: 'Bulka', ru: 'Bulka' },
        description: { kk: 'A', ru: 'B' },
        footer: { kk: 'C', ru: 'D' },
      },
      seo: {
        title: { kk: 'E', ru: 'F' },
        description: { kk: 'G', ru: 'H' },
      },
      theme: {
        preset: 'bulka',
        backgroundMode: 'brand',
        backgroundColor: '#FFB814',
        gradientFrom: '#FFD56A',
        gradientTo: '#F4A916',
        gradientDirection: 'bottom-right',
        backgroundOverlayColor: '#532814',
        backgroundOverlayOpacity: 0,
        textColor: '#532814',
        mutedTextColor: '#78665D',
        surfaceColor: '#FFFFFF',
        buttonBackgroundColor: '#FFFFFF',
        buttonTextColor: '#532814',
        primaryButtonBackgroundColor: '#FFB814',
        primaryButtonTextColor: '#3F1D0E',
        buttonStyle: 'soft',
        animation: 'stagger',
        buttonEffect: 'shine',
        radius: 20,
      },
      blocks: [],
    } satisfies TaplinkDocument;
    const changed = {
      ...document,
      profile: { ...document.profile, title: { kk: 'Changed', ru: 'Bulka' } },
    };

    expect(taplinkFingerprint(changed)).not.toBe(taplinkFingerprint(document));
  });
});
