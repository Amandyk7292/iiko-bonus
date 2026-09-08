const { XMLParser, XMLValidator } = require('fast-xml-parser');

function parseXml(text) {
  // Only predefined XML entities are needed by iiko documents. Never accept a DTD.
  if (/<!\s*(?:DOCTYPE|ENTITY)/i.test(text) || XMLValidator.validate(text) !== true)
    throw Object.assign(new Error('IIKO_REPORT_RESPONSE'), {
      code: 'IIKO_REPORT_RESPONSE',
      statusCode: 502,
    });
  return new XMLParser({ parseTagValue: false, ignoreAttributes: true }).parse(text);
}
module.exports = { parseXml };
