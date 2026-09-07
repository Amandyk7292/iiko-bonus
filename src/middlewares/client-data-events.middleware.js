const realtime = require('../services/realtime.service');

// Only invalidation topics cross the public boundary, never admin response bodies.
const publicDomains = (path) => {
  if (/\/(?:upload(?:-image)?|translate|probe|preview)(?:\/|$)/.test(path)) return [];
  const resource = path.replace(/^\/admin\/api\//, '');
  if (/^(menu|inventory|staff\/catalog)(\/|$)/.test(resource)) return ['menu'];
  if (/^(locations|cities|points)(\/|$)/.test(resource)) return ['locations', 'menu'];
  if (/^(stories|news|promotions)(\/|$)/.test(resource)) return ['content', 'checkout'];
  if (/^contact-(cards|actions)(\/|$)/.test(resource)) return ['contacts'];
  if (/^gift-cards(\/|$)/.test(resource)) return ['rewards'];
  if (/^(settings|loyalty-tiers)(\/|$)/.test(resource)) return ['settings', 'loyalty', 'checkout'];
  if (
    /^(site-access|online-ordering|app-releases?|integrations\/payments\/widget)(\/|$)/.test(
      resource,
    )
  )
    return ['settings', 'checkout'];
  if (/^(push\/mass|broadcast)$/.test(resource)) return ['notifications'];
  return [];
};

function clientDataEvents(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const path = req.path;
  if (!path.startsWith('/admin/api/')) return next();
  // A few older controllers return success:false with a 200 status.
  let failed = false;
  const json = res.json;
  res.json = function (body) {
    failed = body?.success === false;
    return json.call(this, body);
  };
  res.once('finish', () => {
    if (!req.admin || failed || res.statusCode < 200 || res.statusCode >= 300) return;
    const domains = publicDomains(path);
    if (domains.length) realtime.publishClientChange(domains);
    if (/^\/admin\/api\/customers\/(update|bonus)$/.test(path) && req.body?.customerId) {
      realtime.publish(
        'customer.updated',
        {},
        { customerId: req.body.customerId, includeAdmins: true },
      );
    }
  });
  next();
}

module.exports = { clientDataEvents, publicDomains };
