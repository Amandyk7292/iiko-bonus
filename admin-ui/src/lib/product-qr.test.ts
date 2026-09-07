import { describe, expect, it } from 'vitest';
import { productPublicUrl, productQrPng } from './product-qr';

describe('permanent product QR', () => {
  const id = '92f43875-b926-4063-8311-8b0e89c6a242';
  it('matches the customer short link without branch, token or expiry', () => {
    expect(productPublicUrl(id)).toBe('https://bulka.com.kz/p/kvQ4dbkmQGODEYsOicaiQg');
    expect(productPublicUrl(id.toUpperCase())).toBe(productPublicUrl(id));
    expect(productPublicUrl('custom/product')).toBe('https://bulka.com.kz/catalog/product/custom%2Fproduct');
    expect(() => productPublicUrl('')).toThrow();
  });
  it('generates the same printable PNG every time', async () => {
    const image = await productQrPng(id);
    expect(await productQrPng(id)).toBe(image);
    const png = Buffer.from(image.split(',')[1], 'base64');
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect(png.readUInt32BE(16)).toBeGreaterThanOrEqual(800);
    expect(png.readUInt32BE(16)).toBe(png.readUInt32BE(20));
  });
});
