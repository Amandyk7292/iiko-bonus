const {
  BASE_URL,
  LEGAL_PAGE_SLUGS,
  SUPPORTED_LEGAL_LANGUAGES,
  common,
  contactCards,
  pages,
  paymentLogos,
} = require('./legal-page-content');

function normalizeLanguage(language) {
  return SUPPORTED_LEGAL_LANGUAGES.includes(language) ? language : 'ru';
}

function legalPagePath(language, slug) {
  const lang = normalizeLanguage(language);
  return lang === 'ru' ? `/${slug}` : `/${lang}/${slug}`;
}

function absoluteLegalPageUrl(language, slug) {
  return `${BASE_URL}${legalPagePath(language, slug)}`;
}

function languageLinks(language, slug) {
  const labels = common[language].languages;
  return SUPPORTED_LEGAL_LANGUAGES.map(
    (code) =>
      `<a href="${legalPagePath(code, slug)}" lang="${code}" hreflang="${code}"${
        code === language ? ' aria-current="page"' : ''
      }>${labels[code]}</a>`,
  ).join('');
}

function alternateLinks(slug) {
  return `${SUPPORTED_LEGAL_LANGUAGES.map(
    (code) =>
      `<link rel="alternate" hreflang="${code}" href="${absoluteLegalPageUrl(code, slug)}" />`,
  ).join('\n    ')}
    <link rel="alternate" hreflang="x-default" href="${absoluteLegalPageUrl('ru', slug)}" />`;
}

function renderSummary(items = []) {
  if (!items.length) return '';
  return `<div class="summary">${items
    .map(
      ([title, description]) =>
        `<article><strong>${title}</strong><span>${description}</span></article>`,
    )
    .join('')}</div>`;
}

function renderCompanyDetails(content) {
  if (!content.details) return '';
  return `<div class="company-lead"><strong>${content.lead[0]}</strong><span>${
    content.lead[1]
  }</span></div>
    <section><dl class="details-list">${content.details
      .map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`)
      .join('')}</dl></section>`;
}

function renderFooter(language, currentSlug) {
  const labels = common[language].footer;
  return `<footer>${LEGAL_PAGE_SLUGS.filter((slug) => slug !== currentSlug)
    .map((slug) => `<a href="${legalPagePath(language, slug)}">${labels[slug]}</a>`)
    .join('')}<span>© 2026 Bulka</span></footer>`;
}

function localizedBody(body) {
  return body
    .replaceAll('{{PAYMENT_LOGOS}}', paymentLogos)
    .replaceAll('{{CONTACTS_RU}}', contactCards.ru)
    .replaceAll('{{CONTACTS_KK}}', contactCards.kk)
    .replaceAll('{{CONTACTS_EN}}', contactCards.en);
}

function renderLegalPage(slug, language = 'ru') {
  const lang = normalizeLanguage(language);
  if (!LEGAL_PAGE_SLUGS.includes(slug)) return null;
  const content = pages[slug]?.[lang];
  if (!content) return null;
  const canonical = absoluteLegalPageUrl(lang, slug);
  return `<!doctype html>
<html lang="${lang}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#ffffff" />
    <meta name="description" content="${content.description}" />
    <meta name="robots" content="index,follow" />
    <link rel="canonical" href="${canonical}" />
    ${alternateLinks(slug)}
    <link rel="icon" type="image/png" sizes="48x48"
      href="/favicon.png?v=20260908-transparent" />
    <link rel="stylesheet" href="/assets/legal/legal.css?v=20260725" />
    <title>${content.title} — Bulka</title>
  </head>
  <body>
    <main>
      <header>
        <div class="topbar">
          <img class="brand" src="/assets/wallet/bulka-wallet-wide-logo.png?v=20260715"
            alt="Bulka" />
          <a class="back" href="/">${common[lang].back}</a>
        </div>
        <nav class="language-switcher" aria-label="${common[lang].language}">
          ${languageLinks(lang, slug)}
        </nav>
        <h1>${content.title}</h1>
        <p class="updated">${content.updated}</p>
      </header>
      ${renderSummary(content.summary)}
      ${renderCompanyDetails(content)}
      ${localizedBody(content.body)}
      ${renderFooter(lang, slug)}
    </main>
  </body>
</html>`;
}

function allLegalPagePaths() {
  return SUPPORTED_LEGAL_LANGUAGES.flatMap((language) =>
    LEGAL_PAGE_SLUGS.map((slug) => legalPagePath(language, slug)),
  );
}

module.exports = {
  LEGAL_PAGE_SLUGS,
  SUPPORTED_LEGAL_LANGUAGES,
  allLegalPagePaths,
  legalPagePath,
  renderLegalPage,
};
