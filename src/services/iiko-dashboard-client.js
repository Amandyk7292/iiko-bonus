const crypto = require('node:crypto');
const fetch = require('node-fetch');
const { servers, credentialsFor } = require('../config/iiko-dashboard');

const failure = (code, statusCode = 502) => Object.assign(new Error(code), { code, statusCode });

class IikoDashboardClient {
  constructor({ fetchImpl = fetch, credentials = credentialsFor, timeoutMs = 20000 } = {}) {
    this.fetch = fetchImpl;
    this.credentials = credentials;
    this.timeoutMs = timeoutMs;
    this.queues = new Map();
  }

  listServers() {
    return servers.map((server) => ({ ...server, configured: Boolean(this.credentials(server)) }));
  }

  async request(server, path, token, body, secretQuery) {
    const url = new URL(`https://${server.host}/resto/api/${path}`);
    if (token) url.searchParams.set('key', token);
    for (const [key, value] of Object.entries(secretQuery || {})) url.searchParams.set(key, value);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetch(url.toString(), {
        method: body ? 'POST' : 'GET',
        redirect: 'error',
        headers: {
          Accept: ['auth', 'logout'].includes(path) ? '*/*' : 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
        size: 20 * 1024 * 1024,
      });
      if (!response.ok) {
        if ([401, 403].includes(response.status)) throw failure('IIKO_REPORT_ACCESS', 409);
        if (response.status === 404) throw failure('IIKO_REPORT_UNAVAILABLE', 409);
        if (response.status === 400) throw failure('IIKO_REPORT_QUERY', 422);
        throw failure('IIKO_REPORT_FAILED');
      }
      const text = await response.text();
      if (path === 'auth' || path === 'logout') return text.trim();
      try {
        return JSON.parse(text);
      } catch {
        throw failure('IIKO_REPORT_RESPONSE');
      }
    } catch (error) {
      // Upstream errors may contain a URL with the password hash or session key.
      if (error.code?.startsWith('IIKO_REPORT_')) throw error;
      throw failure(error.name === 'AbortError' ? 'IIKO_REPORT_TIMEOUT' : 'IIKO_REPORT_NETWORK');
    } finally {
      clearTimeout(timeout);
    }
  }

  async withSession(serverId, work) {
    const server = servers.find((item) => item.id === serverId);
    if (!server) throw failure('IIKO_REPORT_SERVER', 400);
    if (!server.active) throw failure('IIKO_REPORT_CLOSED', 409);
    const credential = this.credentials(server);
    if (!credential) throw failure('IIKO_REPORT_NOT_CONFIGURED', 409);
    const previous = this.queues.get(serverId) || Promise.resolve();
    const current = previous
      .catch(() => {})
      .then(async () => {
        let token;
        try {
          token = await this.request(server, 'auth', null, null, {
            login: credential.login,
            pass: crypto.createHash('sha1').update(credential.password).digest('hex'),
          });
          if (!/^[a-f0-9-]{32,40}$/i.test(token)) {
            token = null;
            throw failure('IIKO_REPORT_ACCESS', 409);
          }
          return await work((path, body) => this.request(server, path, token, body));
        } finally {
          if (token) await this.request(server, 'logout', token).catch(() => {});
        }
      });
    this.queues.set(serverId, current);
    try {
      return await current;
    } finally {
      if (this.queues.get(serverId) === current) this.queues.delete(serverId);
    }
  }
}

module.exports = { IikoDashboardClient, failure };
