const assert = require('node:assert/strict');
const test = require('node:test');
const { renderLegalPage } = require('../src/services/legal-page.service');

const localizedClauses = {
  ru: {
    revision: 'Редакция от 3 октября 2026 года',
    conditions: /по адресу, указанному в заказе, с соблюдением согласованных условий доставки/,
    unavailable:
      /получатель не открыл дверь, отсутствует или не отвечает после попыток курьера и Bulka связаться/,
    failed: /неудачная попытка вручения по причинам, зависящим от получателя/,
    noFreeRepeat: /Бесплатная повторная доставка и повторная выдача товаров не предусмотрены/,
    noAutomaticRefund: /Автоматический полный возврат оплаты за товары и доставку не производится/,
    costs: /подтверждённых фактически понесённых разумных расходов/,
    law: /требований законодательства Республики Казахстан/,
    errorException: /не применяется при ошибке Bulka или курьера/,
    rights: /не ограничивает обязательные права потребителя/,
    refundLink: '/payment-and-refund',
  },
  kk: {
    revision: '2026 жылғы 3 қазандағы редакция',
    conditions: /тапсырыста көрсетілген мекенжайға келісілген жеткізу шарттарын сақтай отырып/,
    unavailable:
      /курьер мен Bulka байланысуға әрекет жасағаннан кейін алушы есікті ашпаса, орнында болмаса немесе жауап бермесе/,
    failed: /алушыға байланысты себептерден тапсырысты табыстаудың сәтсіз әрекеті тіркеледі/,
    noFreeRepeat: /Тегін қайта жеткізу және тауарларды қайта беру көзделмеген/,
    noAutomaticRefund: /төлем толық көлемде автоматты түрде қайтарылмайды/,
    costs: /расталған, іс жүзінде жұмсалған ақылға қонымды шығындарды/,
    law: /Қазақстан Республикасы заңнамасының талаптарын/,
    errorException: /Bulka немесе курьер қателескен жағдайда бұл шарт қолданылмайды/,
    rights: /тұтынушының заңмен кепілдендірілген құқықтарын шектемейді/,
    refundLink: '/kk/payment-and-refund',
  },
  en: {
    revision: 'Revision dated 3 October 2026',
    conditions: /address stated in the order in accordance with the agreed delivery terms/,
    unavailable:
      /recipient does not open the door, is absent or does not respond after the courier and Bulka attempt to contact/,
    failed: /unsuccessful handover for reasons attributable to the recipient is recorded/,
    noFreeRepeat: /Free redelivery and a second supply of the ordered goods are not provided/,
    noAutomaticRefund: /no automatic full refund for the goods and delivery/,
    costs: /documented reasonable costs actually incurred/,
    law: /laws of the Republic of Kazakhstan/,
    errorException: /does not apply where Bulka or the courier has made an error/,
    rights: /does not limit mandatory consumer rights/,
    refundLink: '/en/payment-and-refund',
  },
};

for (const [language, clauses] of Object.entries(localizedClauses)) {
  test(`delivery terms in ${language} distinguish customer-unavailable handover from seller errors and preserve refund rights`, () => {
    const html = renderLegalPage('delivery-terms', language);
    const normalized = html.replace(/\s+/g, ' ');
    assert.ok(normalized.includes(clauses.revision));
    const receiving = normalized.match(/<section id="receiving-order">(.*?)<\/section>/)?.[1];
    assert.ok(receiving, 'The recipient-unavailable clause has a stable section anchor');
    for (const name of [
      'conditions',
      'unavailable',
      'failed',
      'noFreeRepeat',
      'noAutomaticRefund',
      'costs',
      'law',
      'errorException',
      'rights',
    ])
      assert.match(receiving, clauses[name], name);
    assert.match(normalized, /href="#receiving-order"/);
    assert.ok(normalized.includes(`href="${clauses.refundLink}"`));
    assert.match(normalized, new RegExp(`<html lang="${language}">`));
    assert.match(normalized, /\+7 701 277 22 33/);
  });
}
