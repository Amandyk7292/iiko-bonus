/** Same reversible UUID encoding as the customer app. No tokens or expiry. */
export function productPublicUrl(id: string): string {
  if (!id.trim()) throw new Error('Не указан товар');
  if (/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id)) {
    const bytes = id.replaceAll('-', '').match(/.{2}/g)!.map((hex) => parseInt(hex, 16));
    const shortId = btoa(String.fromCharCode(...bytes))
      .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
    return `https://bulka.com.kz/p/${shortId}`;
  }
  return `https://bulka.com.kz/catalog/product/${encodeURIComponent(id)}`;
}

export async function productQrPng(id: string): Promise<string> {
  const { toDataURL } = await import('qrcode');
  return toDataURL(productPublicUrl(id), {
    type: 'image/png', errorCorrectionLevel: 'M', margin: 4, scale: 24,
    color: { dark: '#000000ff', light: '#ffffffff' },
  });
}

export async function downloadProductQr(id: string): Promise<void> {
  const href = await productQrPng(id);
  const link = document.createElement('a');
  link.href = href;
  link.download = `bulka-product-${id.replace(/[^\w-]/g, '_')}-qr.png`;
  document.body.appendChild(link);
  link.click();
  link.remove();
}
