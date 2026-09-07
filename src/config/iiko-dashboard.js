// Reporting sources are explicit: Chain and its RMS servers must never be summed together.
const rms = {
  aktau: [
    'pekarnya-bulka-ip-maidanov',
    'bulka-mkr5-d7',
    'bulka',
    'bulka-9-mkr',
    'bulka-2',
    'bulka-17-mkr-55-dom',
    'bulka-17mkr-6',
    'bulka-17mkr',
    'bulka-18a',
    'bulka-19-33',
    'bulka26mkr-25b',
    'bulka-28mkr',
    'bulka-atyrau-pristroyka-23a',
    'bulka-40-2',
    'bulka-dostavka',
    'bulka-trc-aktau',
  ],
  astana: [
    'bulka-turan-43',
    'bulka-astana-turan-42',
    'bulka-al-farabi',
    'bulka-astana-tole-bi',
    'bulka-astana',
  ],
};
const closed = new Set(['bulka-atyrau-pristroyka-23a', 'bulka-dostavka', 'bulka-trc-aktau']);
const chains = { aktau: 'bulka-co', astana: 'bulka-astana-co' };
const servers = Object.freeze(
  Object.entries(chains).flatMap(([city, host]) => [
    { id: `${city}-chain`, city, kind: 'chain', active: true, host: `${host}.iiko.it` },
    ...rms[city].map((name) => ({
      id: name,
      city,
      kind: 'rms',
      active: !closed.has(name),
      host: `${name}.iiko.it`,
    })),
  ]),
);

function credentialsFor(server, env = process.env) {
  if (!server.active) return null;
  // The user supplied an account for each city. An explicit RMS account can override it.
  const prefix =
    server.kind === 'chain'
      ? `IIKO_DASHBOARD_${server.city.toUpperCase()}`
      : `IIKO_DASHBOARD_${server.id.toUpperCase().replaceAll('-', '_')}`;
  const cityPrefix = `IIKO_DASHBOARD_${server.city.toUpperCase()}`;
  const accountPrefix = env[`${prefix}_LOGIN`] || env[`${prefix}_PASSWORD`] ? prefix : cityPrefix;
  const login = String(env[`${accountPrefix}_LOGIN`] || '').trim();
  const password = String(env[`${accountPrefix}_PASSWORD`] || '');
  return login && password ? { login, password } : null;
}

module.exports = { servers, credentialsFor };
