const {
  writeoffControl,
  operationsControl,
  assortmentControl,
} = require('./iiko-dashboard-controls');
const previousRange = (input) => {
  const days = (Date.parse(input.to) - Date.parse(input.from)) / 86400000 + 1;
  return {
    from: new Date(Date.parse(input.from) - days * 86400000).toISOString().slice(0, 10),
    to: new Date(Date.parse(input.from) - 86400000).toISOString().slice(0, 10),
  };
};
async function controls(service, input) {
  const filters = [
    { field: 'OrderDeleted', values: ['NOT_DELETED'] },
    { field: 'DeletedWithWriteoff', values: ['NOT_DELETED'] },
    ...(input.department ? [{ field: 'Department', values: [input.department] }] : []),
  ];
  const base = {
    serverId: input.serverId,
    from: input.from,
    to: input.to,
    reportType: 'SALES',
    filters,
  };
  const documentQuery = {
    serverId: input.serverId,
    from: input.from,
    to: input.to,
    department: input.department,
    view: 'writeoffDocuments',
  };
  let result;
  if (input.mode === 'writeoffs') {
    const [documents, revenue, previous] = await Promise.all([
      service.analytics(documentQuery),
      service.report({
        ...base,
        groupBy: ['Department', 'OpenDate.Typed'],
        aggregate: ['DishDiscountSumInt'],
      }),
      service.analytics({ ...documentQuery, ...previousRange(input) }),
    ]);
    result = writeoffControl(input, documents, revenue, previous);
  } else if (input.mode === 'operations') {
    const query = {
      ...base,
      groupBy: [
        'Department',
        'UniqOrderId.Id',
        'OrderNum',
        'SourceOrderNum',
        'OpenDate.Typed',
        'CloseTime',
        'Cashier.Id',
        'Cashier',
        'AuthUser',
        'OrderDiscount.Type',
      ],
      aggregate: ['DishSumInt', 'DiscountSum', 'DishReturnSum'],
    };
    const [discounts, returns] = await Promise.all([
      service.report({
        ...query,
        filters: [
          ...filters,
          { field: 'DiscountPercent', values: [0], exclude: true },
          { field: 'Storned', values: ['FALSE'] },
        ],
      }),
      service.report({ ...query, filters: [...filters, { field: 'Storned', values: ['TRUE'] }] }),
    ]);
    result = operationsControl(input, discounts, returns);
  } else {
    const query = {
      ...base,
      filters: [...filters, { field: 'Storned', values: ['FALSE'] }],
      groupBy: ['Department', 'DishId', 'DishName', 'DishMeasureUnit'],
      aggregate: ['DishAmountInt'],
    };
    const [current, previous, writeoffs] = await Promise.all([
      service.report(query),
      service.report({ ...query, ...previousRange(input) }),
      service.analytics(documentQuery),
    ]);
    result = assortmentControl(input, current, previous, writeoffs);
  }
  return {
    ...result,
    period: { from: input.from, to: input.to },
    serverId: input.serverId,
    fetchedAt: Object.values(result.tables)
      .map((t) => t.fetchedAt)
      .sort()[0],
  };
}
module.exports = { controls, previousRange };
