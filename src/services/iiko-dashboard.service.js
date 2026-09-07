const { IikoDashboardClient, failure } = require('./iiko-dashboard-client');
const { analyticsQuery, analyticsReport } = require('./iiko-dashboard-analytics');
const { ReportCache } = require('./iiko-dashboard-cache');
const dateFields = {
  SALES: 'OpenDate.Typed',
  TRANSACTIONS: 'DateTime.DateTyped',
  DELIVERIES: 'OpenDate.Typed',
};

function buildReport(input, columns) {
  const dateField = dateFields[input.reportType];
  if (!columns[dateField]?.filteringAllowed) throw failure('IIKO_REPORT_UNAVAILABLE', 409);
  for (const field of input.groupBy) {
    if (!columns[field]?.groupingAllowed) throw failure('IIKO_REPORT_FIELD', 400);
  }
  for (const field of input.aggregate) {
    if (!columns[field]?.aggregationAllowed) throw failure('IIKO_REPORT_FIELD', 400);
  }
  const filters = Object.create(null);
  for (const filter of input.filters) {
    if (
      filter.field === dateField ||
      !columns[filter.field]?.filteringAllowed ||
      filters[filter.field]
    ) {
      throw failure('IIKO_REPORT_FIELD', 400);
    }
    filters[filter.field] = {
      filterType: filter.exclude ? 'ExcludeValues' : 'IncludeValues',
      values: filter.values,
    };
  }
  const end = new Date(`${input.to}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  filters[dateField] = {
    filterType: 'DateRange',
    periodType: 'CUSTOM',
    from: `${input.from}T00:00:00.000`,
    to: `${end.toISOString().slice(0, 10)}T00:00:00.000`,
    includeLow: true,
    includeHigh: false,
  };
  return {
    reportType: input.reportType,
    buildSummary: false,
    groupByRowFields: input.groupBy,
    groupByColFields: [],
    aggregateFields: input.aggregate,
    filters,
  };
}

class IikoDashboardService {
  constructor(client = new IikoDashboardClient()) {
    this.client = client;
    this.schemas = new Map();
    this.schemaRequests = new Map();
    this.reports = new ReportCache();
  }
  listServers() {
    return this.client.listServers();
  }
  async columns(request, serverId, reportType) {
    const key = `${serverId}:${reportType}`;
    const cached = this.schemas.get(key);
    if (cached && cached.expires > Date.now()) return cached.columns;
    if (this.schemaRequests.has(key)) return this.schemaRequests.get(key);
    const pending = this.loadColumns(request, key, reportType);
    this.schemaRequests.set(key, pending);
    try {
      return await pending;
    } finally {
      this.schemaRequests.delete(key);
    }
  }
  async loadColumns(request, key, reportType) {
    const columns = await request(`v2/reports/olap/columns?reportType=${reportType}`);
    if (!columns || Array.isArray(columns) || typeof columns !== 'object')
      throw failure('IIKO_REPORT_RESPONSE');
    this.schemas.set(key, { columns, expires: Date.now() + 3600000 });
    return columns;
  }
  async getSchema(input) {
    const cached = this.schemas.get(`${input.serverId}:${input.reportType}`);
    if (cached && cached.expires > Date.now())
      return { columns: cached.columns, dateField: dateFields[input.reportType] };
    return this.client.withSession(input.serverId, async (request) => ({
      columns: await this.columns(request, input.serverId, input.reportType),
      dateField: dateFields[input.reportType],
    }));
  }
  async report(input) {
    return this.reports.get(JSON.stringify(input), () => this.loadReport(input));
  }
  async loadReport(input) {
    return this.client.withSession(input.serverId, async (request) => {
      const columns = await this.columns(request, input.serverId, input.reportType);
      const result = await request('v2/reports/olap', buildReport(input, columns));
      if (!Array.isArray(result?.data)) throw failure('IIKO_REPORT_RESPONSE');
      if (result.data.length > 25000) throw failure('IIKO_REPORT_TOO_LARGE', 422);
      return {
        rows: result.data,
        period: { from: input.from, to: input.to },
        columns: Object.fromEntries(
          [...input.groupBy, ...input.aggregate].map((key) => [key, columns[key]]),
        ),
        fetchedAt: new Date().toISOString(),
        serverId: input.serverId,
      };
    });
  }
  async analytics(input) {
    const report = await this.report(analyticsQuery(input));
    return analyticsReport(report, input);
  }
  async balances(input) {
    return this.client.withSession(input.serverId, async (request) => {
      const rows = await request(`v2/reports/balance/stores?timestamp=${input.date}T23:59:59`);
      if (!Array.isArray(rows)) throw failure('IIKO_REPORT_RESPONSE');
      const products = await request('v2/entities/products/list');
      const stores = await request('corporation/stores');
      const groups = await request('v2/entities/products/group/list');
      if (!Array.isArray(products) || !Array.isArray(stores)) throw failure('IIKO_REPORT_RESPONSE');
      return {
        rows,
        groups: Array.isArray(groups)
          ? groups.map(({ id, name, parent }) => ({ id, name, parent }))
          : [],
        products: products.map(({ id, name, parent, storeBalanceLevels }) => ({
          id,
          name,
          parent,
          storeBalanceLevels,
        })),
        stores: stores.map(({ id, name }) => ({ id, name })),
        fetchedAt: new Date().toISOString(),
        serverId: input.serverId,
      };
    });
  }
}
module.exports = { IikoDashboardService, buildReport, service: new IikoDashboardService() };
