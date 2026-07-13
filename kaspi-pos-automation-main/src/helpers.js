import crypto from 'crypto';
import fetch from 'node-fetch';
import { DEVICE, APP, UA_NATIVE } from './config.js';
import { computeTokenSnMac, computeXSign, computeXSU } from './crypto.js';
import { inactiveSessionResponse } from './activeSession.js';
import { getKaspiErrorMessage, isKaspiSessionExpired } from './kaspiResponse.js';

// ─── Utilities ───

export const generateUUID = () => crypto.randomUUID().toUpperCase();

export const nowISO = () => {
  const d = new Date();
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const hh = String(Math.floor(Math.abs(off) / 60)).padStart(2, '0');
  const mm = String(Math.abs(off) % 60).padStart(2, '0');

  const localD = new Date(d.getTime() + off * 60000);
  return (
    localD
      .toISOString()
      .replace('Z', '')
      .replace(/\.\d{3}/, `.${String(d.getMilliseconds()).padStart(3, '0')}`) +
    sign +
    hh +
    mm
  );
};

// ─── Cookie builder ───

export const entranceCookie = (extraUserToken) => {
  let c = `deviceId=${DEVICE.deviceId}; installId=${DEVICE.installId}; is_mobile_app=true; locale=${APP.locale}; ma_bld=${APP.build}; ma_platform_type=${APP.platform}; ma_platform_ver=${APP.platformVer}; ma_ver=${APP.version}; pk=${DEVICE.pk}; pkTag=${DEVICE.pkTag}; xs=R:0|E:0|RH:0|N:0`;
  if (extraUserToken) c += `; user_token=${extraUserToken}`;
  return c;
};

// ─── Extract user_token from set-cookie ───

export const extractUserToken = (resp) => {
  const raw = resp.headers.raw()['set-cookie'] || [];
  for (const c of raw) {
    const m = c.match(/user_token=([^;]+)/);
    if (m) return m[1];
  }
  return null;
};

// ─── Logged fetch wrapper ───

export const loggedFetch = async (url, options = {}) => {
  const method = (options.method || 'GET').toUpperCase();
  const safeUrl = new URL(url);
  console.log(`>>> Kaspi ${method} ${safeUrl.origin}${safeUrl.pathname}`);

  const resp = await fetch(url, options);
  console.log(`<<< Kaspi ${resp.status} ${resp.statusText}`);
  return resp;
};

export const kaspiProxyJson = async (res, resp, fallback = 'Kaspi отклонил запрос.') => {
  const body = await resp.json().catch(() => ({}));
  if (isKaspiSessionExpired(body)) {
    return res.status(401).json(inactiveSessionResponse(getKaspiErrorMessage(body, fallback)));
  }
  return res.status(resp.ok ? 200 : resp.status).json(body);
};

// ─── Signed QR-pay headers (session passed as parameter) ───

export const signedQrPayHeaders = (url, session) => {
  const xsh =
    'url,X-Kb-Client-Ip,X-Time,X-App-Ver,X-SV,X-Locale,X-App-Bld,X-Install-ID,X-Kb-TokenSn,X-S,X-Kb-TokenSnMac,X-Call';
  const headers = {
    'X-Kb-TokenSn': session.tokenSN,
    'X-Kb-TokenSnMac': computeTokenSnMac(session.tokenSN, session.decryptedSecret),
    'X-Install-ID': DEVICE.installId,
    'X-App-Ver': APP.version,
    'X-App-Bld': APP.build,
    'X-Locale': APP.locale,
    'X-Time': nowISO(),
    'X-Request-ID': generateUUID(),
    'X-Call': 'notConnected',
    'X-SV': '2',
    'X-SH': xsh,
    'X-SU': computeXSU(url),
    'X-Kb-Client-Ip': '192.168.1.96',
    'User-Agent': UA_NATIVE,
    'X-PkTag': DEVICE.pkTag,
    Cookie: entranceCookie(),
    Accept: '*/*',
    'Accept-Language': 'ru',
    'Accept-Encoding': 'gzip, deflate, br',
  };
  headers['X-Sign'] = computeXSign(url, headers, xsh);
  return headers;
};
