const { failure } = require('./iiko-dashboard-client-errors');

async function reportSource(service, id) {
  const source = (await service.listServers()).find((server) => server.id === id);
  if (!source) throw failure('IIKO_REPORT_SERVER', 400);
  if (!source.active) throw failure('IIKO_REPORT_CLOSED', 409);
  if (!source.configured) throw failure('IIKO_REPORT_NOT_CONFIGURED', 409);
  return source;
}

module.exports = { reportSource };
