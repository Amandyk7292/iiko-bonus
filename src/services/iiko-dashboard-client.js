const crypto = require('node:crypto');
const fetch = require('node-fetch');
const { servers, credentialsFor } = require('../config/iiko-dashboard');
const { failure } = require('./iiko-dashboard-client-errors');

class IikoDashboardClient {
  constructor(options = {}) {
    const {
      fetchImpl = fetch,
      credentials = credentialsFor,
      serverRegistry,
      timeoutMs = 20000,
      reportTimeoutMs = 45000,
    } = options;
    this.fetch = fetchImpl;
    this.credentials = credentials;
    this.serverRegistry =
      serverRegistry === undefined && credentials === credentialsFor
        ? require('./iiko-dashboard-servers.service').registry
        : serverRegistry;
    this.timeoutMs = timeoutMs;
    this.reportTimeoutMs = reportTimeoutMs;
    this.queues = new Map();
  }

  async listServers() {
    if (this.serverRegistry) return this.serverRegistry.list();
    return servers.map((server) => ({ ...server, configured: Boolean(this.credentials(server)) }));
  }

  async saveServer(input) {
    if (!this.serverRegistry) throw failure('IIKO_REPORT_SERVER_STORAGE');
    return this.serverRegistry.save(input);
  }

  async deleteServer(id) {
    if (!this.serverRegistry) throw failure('IIKO_REPORT_SERVER_STORAGE');
    return this.serverRegistry.remove(id);
  }

  async request(server, path, token, body, secretQuery, format = 'json') {
    const url = new URL(`https://${server.host}/resto/api/${path}`);
    if (token) url.searchParams.set('key', token);
    for (const [key, value] of Object.entries(secretQuery || {})) url.searchParams.set(key, value);
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      path === 'v2/reports/olap' || path.startsWith('documents/export/')
        ? this.reportTimeoutMs
        : this.timeoutMs,
    );
    try {
      const response = await this.fetch(url.toString(), {
        method: body ? 'POST' : 'GET',
        redirect: 'error',
        headers: {
          Accept: ['auth', 'logout'].includes(path)
            ? '*/*'
            : format === 'xml'
              ? 'application/xml'
              : 'application/json',
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
      if (format === 'xml') return require('./iiko-dashboard-xml').parseXml(text);
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
    const server = this.serverRegistry
      ? await this.serverRegistry.find(serverId)
      : servers.find((item) => item.id === serverId);
    if (!server) throw failure('IIKO_REPORT_SERVER', 400);
    if (!server.active) throw failure('IIKO_REPORT_CLOSED', 409);
    const credential = this.serverRegistry
      ? this.serverRegistry.credentials(server)
      : this.credentials(server);
    if (!credential) throw failure('IIKO_REPORT_NOT_CONFIGURED', 409);
    let queue = this.queues.get(serverId);
    if (!queue) {
      queue = { jobs: [], running: false };
      this.queues.set(serverId, queue);
    }
    const result = new Promise((resolve, reject) => queue.jobs.push({ work, resolve, reject }));
    if (!queue.running) void this.drain(server, credential, queue);
    return result;
  }

  async drain(server, credential, queue) {
    queue.running = true;
    while (queue.jobs.length) {
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
        const started = Date.now();
        // Share one login for a burst, with at most three reporting jobs at once.
        // Never log out while another job is still using this session.
        do {
          await Promise.all(
            queue.jobs.splice(0, 3).map(async (job) => {
              try {
                job.resolve(
                  await job.work((path, body, format) =>
                    this.request(server, path, token, body, undefined, format),
                  ),
                );
              } catch (error) {
                job.reject(error);
              }
            }),
          );
        } while (queue.jobs.length && Date.now() - started < 30000);
      } catch (error) {
        for (const job of queue.jobs.splice(0)) job.reject(error);
      } finally {
        if (token) await this.request(server, 'logout', token).catch(() => {});
      }
    }
    queue.running = false;
    if (this.queues.get(server.id) === queue) this.queues.delete(server.id);
  }
}

module.exports = { IikoDashboardClient, failure };
