async function receipt(service, input) {
  return service.report({
    serverId: input.serverId,
    reportType: 'SALES',
    from: input.date,
    to: input.date,
    filters: [
      { field: 'UniqOrderId.Id', values: [input.orderId] },
      { field: 'Department', values: [input.department] },
      { field: 'OrderDeleted', values: ['NOT_DELETED'] },
      { field: 'DeletedWithWriteoff', values: ['NOT_DELETED'] },
      { field: 'Storned', values: ['FALSE'] },
    ],
    // Separate discounted and full-price quantities without multiplying rows by discount names.
    groupBy: ['DishId', 'DishName', 'DishMeasureUnit', 'DiscountPercent'],
    aggregate: ['DishAmountInt', 'DishSumInt', 'DiscountSum', 'DishDiscountSumInt'],
  });
}
module.exports = { receipt };
