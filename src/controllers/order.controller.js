const {
  listAdminOrders,
  listCustomerOrders,
  updateAdminOrderStatus,
} = require('../services/customer-order.service');

const listCustomer = async (req, res) => {
  try {
    res.set('Cache-Control', 'private, no-store');
    const scope = req.query.scope === 'completed' ? 'completed' : 'active';
    const result = await listCustomerOrders(req.customerAuth.id, {
      scope,
      page: req.query.page,
      pageSize: req.query.pageSize,
    });
    res.json({
      success: true,
      ...result,
      revision: result.orders.reduce(
        (latest, order) => (order.updatedAt > latest ? order.updatedAt : latest),
        '',
      ),
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      error: error.statusCode ? error.message : 'Не удалось загрузить заказы',
      code: error.statusCode ? error.code : undefined,
    });
  }
};

const listAdmin = async (req, res) => {
  try {
    res.set('Cache-Control', 'private, no-store');
    const result = await listAdminOrders(req.query);
    res.json({
      success: true,
      ...result,
      revision: result.orders.reduce(
        (latest, order) => (order.updatedAt > latest ? order.updatedAt : latest),
        '',
      ),
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      error: error.statusCode ? error.message : 'Не удалось загрузить заказы',
      code: error.statusCode ? error.code : undefined,
    });
  }
};

const updateAdminStatus = async (req, res) => {
  try {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        req.params.id,
      )
    ) {
      return res.status(400).json({ error: 'Некорректный идентификатор заказа' });
    }
    const requestedStatus = String(req.body?.status || '');
    if (requestedStatus === 'cancelled' && req.admin?.role !== 'admin') {
      return res
        .status(403)
        .json({ error: 'Возврат оплаченного заказа доступен только администратору' });
    }
    const order = await updateAdminOrderStatus(
      req.params.id,
      requestedStatus,
      req.body?.cancellationReason,
    );
    res.json({ success: true, order });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      error: error.statusCode ? error.message : 'Не удалось изменить статус заказа',
      code: error.statusCode ? error.code : undefined,
    });
  }
};

module.exports = { listAdmin, listCustomer, updateAdminStatus };
