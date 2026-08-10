#!/usr/bin/env node

const baseUrl = new URL(process.env.PRODUCTION_BASE_URL || 'https://bulka.com.kz');
const canonicalHost = baseUrl.hostname;
const wwwUrl = new URL(baseUrl.toString());
wwwUrl.hostname = `www.${canonicalHost}`;
const requireCloudflare = /^(1|true|yes)$/i.test(
  String(process.env.MONITOR_REQUIRE_CLOUDFLARE || ''),
);
const timeoutMs = Number(process.env.MONITOR_TIMEOUT_MS || 12_000);

if (baseUrl.protocol !== 'https:' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1000) {
  throw new Error('Production monitor configuration is invalid');
}

const checks = [];

async function request(pathname, { redirect = 'follow' } = {}) {
  const url = new URL(pathname, baseUrl);
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Bulka-Production-Monitor/1.0' },
    redirect,
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { response, url };
}

async function check(name, task) {
  try {
    await task();
    checks.push({ name, ok: true });
  } catch (error) {
    checks.push({
      name,
      ok: false,
      error: String(error?.message || error).slice(0, 240),
    });
  }
}

await check('health', async () => {
  const { response } = await request('/healthz');
  if (!response.ok) throw new Error(`healthz returned ${response.status}`);
  const body = await response.json();
  if (body?.status !== 'ok') throw new Error('healthz payload is not healthy');
  if (requireCloudflare && !response.headers.get('cf-ray')) {
    throw new Error('Cloudflare proxy header is missing');
  }
});

await check('readiness', async () => {
  const { response } = await request('/readyz');
  if (!response.ok) throw new Error(`readyz returned ${response.status}`);
  const body = await response.json();
  if (body?.status !== 'ready') throw new Error('readyz payload is not ready');
});

await check('release-provenance', async () => {
  const { response } = await request('/release-version.json');
  if (!response.ok) throw new Error(`release version returned ${response.status}`);
  const body = await response.json();
  if (!/^[a-f0-9]{40}$/.test(String(body?.version || ''))) {
    throw new Error('release version is not a commit SHA');
  }
  if (!/^[a-f0-9]{64}$/.test(String(body?.mainSha256 || ''))) {
    throw new Error('release bundle checksum is invalid');
  }
});

await check('www-canonical-redirect', async () => {
  const target = new URL('/healthz', wwwUrl);
  const response = await fetch(target, {
    headers: { 'User-Agent': 'Bulka-Production-Monitor/1.0' },
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (![301, 308].includes(response.status)) {
    throw new Error(`www returned ${response.status} instead of a permanent redirect`);
  }
  const location = response.headers.get('location');
  const redirected = location ? new URL(location, target) : null;
  if (redirected?.hostname !== canonicalHost || redirected.protocol !== 'https:') {
    throw new Error('www does not redirect to the canonical HTTPS host');
  }
});

const failed = checks.filter((item) => !item.ok);
process.stdout.write(
  `${JSON.stringify({ checkedAt: new Date().toISOString(), baseUrl: baseUrl.origin, checks })}\n`,
);
if (failed.length > 0) process.exitCode = 1;
