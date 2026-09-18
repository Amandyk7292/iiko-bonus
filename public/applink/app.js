/* global document, fetch */

const storeButtons = new Map(
  [...document.querySelectorAll('[data-platform]')].map((button) => [
    button.dataset.platform,
    button,
  ]),
);

async function updateStoreLink(platform) {
  const button = storeButtons.get(platform);
  if (!button) return;
  try {
    const response = await fetch(`/api/public/app-release?platform=${platform}`, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return;
    const policy = await response.json();
    if (policy.success && typeof policy.storeUrl === 'string' && policy.storeUrl) {
      button.href = policy.storeUrl;
    }
  } catch {
    // Keep the published fallback URL when settings are temporarily unavailable.
  }
}

void Promise.all([updateStoreLink('ios'), updateStoreLink('android')]);
