const {
  normalizeLanguage,
  reverseAddress,
  searchAddresses,
} = require('../services/geocode.service');

const language = (req) => normalizeLanguage(req.get('accept-language'));

const search = async (req, res) => {
  try {
    const results = await searchAddresses(req.query.q, language(req));
    res.set('Cache-Control', 'public, max-age=300');
    res.json({ success: true, results });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
};

const reverse = async (req, res) => {
  try {
    const result = await reverseAddress(req.query.lat, req.query.lon, language(req));
    res.set('Cache-Control', 'public, max-age=300');
    res.json({ success: true, result });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
};

module.exports = { reverse, search };
