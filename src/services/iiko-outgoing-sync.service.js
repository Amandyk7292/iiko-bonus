const { randomUUID } = require('node:crypto');
const { supabase } = require('../config/supabase');
const { logger } = require('../config/logger');
const { IikoDashboardClient } = require('./iiko-dashboard-client');
const {
  bindings,
  loadOutgoingDocuments,
  normalizeDocuments,
} = require('./iiko-outgoing-documents');
const realtime = require('./realtime.service');

const localDate = (date) =>
  new Date(new Date(date).getTime() + 5 * 3600000).toISOString().slice(0, 10);
const addDays = (date, days) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const failure = (code) => Object.assign(new Error(code), { code });

class IikoOutgoingSync {
  constructor({
    db = supabase,
    client = new IikoDashboardClient(),
    env = process.env,
    now = () => new Date(),
    publish = realtime.publish,
    log = logger,
  } = {}) {
    Object.assign(this, { db, client, env, now, publish, log });
  }
  async rpc(name, parameters) {
    const { data, error } = await this.db.rpc(name, parameters);
    if (error) {
      if (String(error.message).includes('date crossed a physical count'))
        throw failure('IIKO_OUTGOING_RECOUNT_REQUIRED');
      if (String(error.message).includes('stock units differ'))
        throw failure('IIKO_OUTGOING_UNIT_MISMATCH');
      throw failure('IIKO_OUTGOING_STORAGE');
    }
    return data;
  }
  async sync() {
    const cities = String(this.env.IIKO_OUTGOING_CITIES ?? 'aktau,astana')
      .split(',')
      .map((city) => city.trim());
    if (
      cities.some((city) => !['aktau', 'astana'].includes(city)) ||
      new Set(cities).size !== cities.length
    )
      throw failure('IIKO_OUTGOING_MAPPING');
    const mapping = bindings(this.env);
    const servers = await this.client.listServers();
    const configured = new Set(Object.values(mapping).map((row) => row.serverId));
    const sources = [...configured].map((id) => servers.find((server) => server.id === id));
    // Never combine an RMS and Chain feed for the same city, or infer branch IDs.
    if (
      sources.some((server) => !server || !['aktau', 'astana'].includes(server.city)) ||
      new Set(sources.map((server) => server.city)).size !== sources.length
    )
      throw failure('IIKO_OUTGOING_MAPPING');
    const errors = [];
    for (const city of cities) {
      if (sources.some((source) => source.city === city)) continue;
      const error = failure('IIKO_OUTGOING_MAPPING_INCOMPLETE');
      errors.push(error);
      this.log.error(
        { event: 'iiko_outgoing_sync_failed', city, code: error.code },
        'Required outgoing city has no explicit branch mapping',
      );
    }
    for (const source of sources) {
      try {
        if (!source.active || !source.configured) throw failure('IIKO_OUTGOING_NOT_CONFIGURED');
        await this.syncSource(source, mapping);
      } catch (error) {
        errors.push(error);
        this.log.error(
          {
            event: 'iiko_outgoing_sync_failed',
            city: source.city,
            code: error.code || 'IIKO_OUTGOING_FAILED',
          },
          'Outgoing invoice sync failed',
        );
      }
    }
    if (errors.length) throw errors[0];
  }
  async syncSource(source, mapping) {
    const lease = randomUUID();
    const args = { p_city: source.city, p_lease: lease };
    const state = await this.rpc('claim_iiko_outgoing_sync', args);
    if (!state) return;
    let nextDate = null;
    try {
      const today = localDate(this.now());
      const firstDate = localDate(state.started_at);
      const scanFrom =
        state.scan_date < firstDate ? firstDate : state.scan_date > today ? today : state.scan_date;
      const scanTo = addDays(scanFrom, 6) < today ? addDays(scanFrom, 6) : today;
      // Fresh documents always have priority; a separate persisted seven-day sweep
      // catches long outages and corrections to older documents without an unbounded export.
      const recentFrom = addDays(today, -1) < firstDate ? firstDate : addDays(today, -1);
      const ranges = [{ from: recentFrom, to: today }];
      if (scanFrom < recentFrom)
        ranges.push({ from: scanFrom, to: scanTo < recentFrom ? scanTo : addDays(recentFrom, -1) });
      for (const { from, to } of ranges) {
        const data = await this.client.withSession(source.id, (request) =>
          loadOutgoingDocuments(request, from, to),
        );
        const documents = normalizeDocuments(data, source, mapping);
        // Validate the complete export before mutating any of its documents.
        for (const document of documents) {
          if (localDate(document.postedAt) < from || localDate(document.postedAt) > to)
            throw failure('IIKO_OUTGOING_RANGE');
        }
        for (const document of documents) {
          const result = await this.rpc('apply_iiko_outgoing_invoice', {
            ...args,
            p_document: document,
          });
          if (!result || typeof result.changed !== 'boolean')
            throw failure('IIKO_OUTGOING_RESPONSE');
          if (result.changed)
            for (const branchId of result.branchIds || []) {
              this.publish(
                'menu.updated',
                { inventory: true, branchId },
                { adminOnly: true, branchId },
              );
            }
          if (result.shortage && !result.duplicate)
            this.log.warn(
              {
                event: 'iiko_outgoing_stock_shortage',
                city: source.city,
                documentId: document.id,
                branchIds: result.branchIds,
              },
              'Outgoing invoice exceeds display stock or reservations; recount required',
            );
        }
      }
      nextDate = scanTo >= today ? firstDate : addDays(scanTo, 1);
    } finally {
      // A failed fetch/apply leaves the date unchanged. Successful earlier invoices
      // have durable identities and are safe to repeat after restart or lost replies.
      await this.rpc('finish_iiko_outgoing_sync', { ...args, p_next_date: nextDate });
    }
  }
}
module.exports = { IikoOutgoingSync, outgoingSync: new IikoOutgoingSync() };
