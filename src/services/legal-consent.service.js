const crypto = require('node:crypto');
const { supabase } = require('../config/supabase');
const { renderLegalPage } = require('./legal-page.service');

const LEGAL_DOCUMENT_VERSIONS = Object.freeze({
  offer: '2026-07-27',
  privacy: '2026-07-27',
});
const LEGAL_LOCALES = new Set(['ru', 'kk', 'en']);
const LEGAL_CHANNELS = new Set(['web', 'android', 'ios', 'mobile_app', 'mobile_api']);

const consentError = (message, code = 'LEGAL_CONSENT_REQUIRED') =>
  Object.assign(new Error(message), { statusCode: 400, code });

const sha256 = (value) => crypto.createHash('sha256').update(value, 'utf8').digest('hex');

const canonicalLegalDocuments = (locale = 'ru') => {
  const normalizedLocale = LEGAL_LOCALES.has(String(locale)) ? String(locale) : 'ru';
  return {
    offerVersion: LEGAL_DOCUMENT_VERSIONS.offer,
    offerHash: sha256(renderLegalPage('public-offer', normalizedLocale)),
    privacyVersion: LEGAL_DOCUMENT_VERSIONS.privacy,
    privacyHash: sha256(renderLegalPage('privacy', normalizedLocale)),
    locale: normalizedLocale,
  };
};

const validateLegalConsent = (payload = {}, now = new Date()) => {
  if (payload.acceptedLegal !== true) {
    throw consentError('Необходимо принять публичную оферту и политику конфиденциальности');
  }
  const source =
    payload.legalConsent && typeof payload.legalConsent === 'object'
      ? payload.legalConsent
      : payload;
  const locale = String(source.locale || '')
    .trim()
    .toLowerCase();
  const channel = String(source.channel || '')
    .trim()
    .toLowerCase();
  if (!LEGAL_LOCALES.has(locale)) {
    throw consentError('Некорректный язык юридических документов', 'LEGAL_CONSENT_INVALID');
  }
  if (!LEGAL_CHANNELS.has(channel)) {
    throw consentError('Некорректный канал регистрации', 'LEGAL_CONSENT_INVALID');
  }
  const canonical = canonicalLegalDocuments(locale);
  if (
    String(source.offerVersion || '') !== canonical.offerVersion ||
    String(source.privacyVersion || '') !== canonical.privacyVersion
  ) {
    throw consentError(
      'Условия обновились. Откройте документы и подтвердите их ещё раз.',
      'LEGAL_DOCUMENT_VERSION_CHANGED',
    );
  }
  if (
    (source.offerHash && String(source.offerHash) !== canonical.offerHash) ||
    (source.privacyHash && String(source.privacyHash) !== canonical.privacyHash)
  ) {
    throw consentError(
      'Условия обновились. Откройте документы и подтвердите их ещё раз.',
      'LEGAL_DOCUMENT_VERSION_CHANGED',
    );
  }
  const acceptedAt = source.acceptedAt == null ? null : new Date(source.acceptedAt);
  if (
    acceptedAt &&
    (Number.isNaN(acceptedAt.getTime()) ||
      acceptedAt.getTime() > now.getTime() + 5 * 60 * 1000 ||
      acceptedAt.getTime() < now.getTime() - 24 * 60 * 60 * 1000)
  ) {
    throw consentError('Некорректное время подтверждения документов', 'LEGAL_CONSENT_INVALID');
  }
  return {
    ...canonical,
    channel,
    acceptedAt: acceptedAt ? acceptedAt.toISOString() : null,
  };
};

async function recordCustomerLegalConsent(customerId, consent) {
  const { data, error } = await supabase.rpc('record_customer_legal_consent', {
    p_customer_id: customerId,
    p_offer_version: consent.offerVersion,
    p_offer_sha256: consent.offerHash,
    p_privacy_version: consent.privacyVersion,
    p_privacy_sha256: consent.privacyHash,
    p_locale: consent.locale,
    p_channel: consent.channel,
    p_client_accepted_at: consent.acceptedAt,
  });
  if (error) throw error;
  return data;
}

module.exports = {
  LEGAL_DOCUMENT_VERSIONS,
  canonicalLegalDocuments,
  recordCustomerLegalConsent,
  validateLegalConsent,
};
