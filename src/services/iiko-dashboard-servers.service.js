const { supabase } = require('../config/supabase');
const { servers: builtInServers, credentialsFor } = require('../config/iiko-dashboard');
const { decryptSecret, encryptSecret } = require('../utils/secret-envelope.util');
const { failure } = require('./iiko-dashboard-client-errors');

const TABLE = 'iiko_dashboard_servers';
const CREDENTIAL_PURPOSE = 'iiko-dashboard-server-credentials';

const publicServer = (server, configured) => ({
  id: server.id,
  host: server.host,
  city: server.city,
  kind: server.kind,
  active: server.active,
  configured,
});

const normalizeRow = (row) => ({
  id: String(row.id),
  host: String(row.host),
  city: row.city,
  kind: row.kind,
  active: row.active !== false,
  credentialCipher: row.credential_cipher || null,
});

class IikoDashboardServerRegistry {
  constructor({ db = supabase, env = process.env, cacheMs = 30000 } = {}) {
    this.db = db;
    this.env = env;
    this.cacheMs = cacheMs;
    this.cached = null;
    this.loadedAt = 0;
    this.loading = null;
  }

  credentials(server) {
    if (!server.credentialCipher) return credentialsFor(server, this.env);
    const value = JSON.parse(
      decryptSecret(server.credentialCipher, {
        purpose: CREDENTIAL_PURPOSE,
        aad: server.id,
        env: this.env,
      }),
    );
    const login = String(value.login || '').trim();
    const password = String(value.password || '');
    return login && password ? { login, password } : null;
  }

  isConfigured(server) {
    try {
      return Boolean(this.credentials(server));
    } catch {
      return false;
    }
  }

  async load(force = false) {
    if (!force && this.cached && Date.now() - this.loadedAt < this.cacheMs) return this.cached;
    if (!force && this.loading) return this.loading;
    this.loading = (async () => {
      const { data, error } = await this.db
        .from(TABLE)
        .select('id,host,city,kind,active,deleted,credential_cipher,updated_at')
        .order('host', { ascending: true });
      if (error) throw failure('IIKO_REPORT_SERVER_STORAGE');
      const merged = new Map(builtInServers.map((server) => [server.id, { ...server }]));
      for (const row of data || []) {
        if (row.deleted) merged.delete(String(row.id));
        else merged.set(String(row.id), normalizeRow(row));
      }
      this.cached = [...merged.values()];
      this.loadedAt = Date.now();
      return this.cached;
    })();
    try {
      return await this.loading;
    } finally {
      this.loading = null;
    }
  }

  async list(force = false) {
    const servers = await this.load(force);
    return servers.map((server) => publicServer(server, this.isConfigured(server)));
  }

  async find(id) {
    return (await this.load()).find((server) => server.id === id) || null;
  }

  async save(input) {
    const id = input.host.slice(0, -'.iiko.it'.length);
    const credentialCipher = input.useCityCredentials
      ? null
      : encryptSecret(JSON.stringify({ login: input.login, password: input.password }), {
          purpose: CREDENTIAL_PURPOSE,
          aad: id,
          env: this.env,
        });
    const { error } = await this.db.from(TABLE).upsert(
      {
        id,
        host: input.host,
        city: input.city,
        kind: input.kind,
        active: true,
        deleted: false,
        credential_cipher: credentialCipher,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' },
    );
    if (error) throw failure('IIKO_REPORT_SERVER_STORAGE');
    return this.list(true);
  }

  async remove(id) {
    const server = await this.find(id);
    if (!server) throw failure('IIKO_REPORT_SERVER', 404);
    const { error } = await this.db.from(TABLE).upsert(
      {
        id: server.id,
        host: server.host,
        city: server.city,
        kind: server.kind,
        active: false,
        deleted: true,
        credential_cipher: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' },
    );
    if (error) throw failure('IIKO_REPORT_SERVER_STORAGE');
    return this.list(true);
  }
}

module.exports = {
  CREDENTIAL_PURPOSE,
  IikoDashboardServerRegistry,
  registry: new IikoDashboardServerRegistry(),
};
