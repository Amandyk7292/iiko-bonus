const {
  listAdminOrders,
  listCustomerOrders,
  updateAdminOrderStatus,
} = require('../services/customer-order.service');

const listCustomer = async (req, res) => {
  try {
    const scope = req.query.scope === 'completed' ? 'completed' : 'active';
    const result = await listCustomerOrders(req.customerAuth.id, {
      scope,
      page: req.query.page,
      pageSize: req.query.pageSize,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
};

const listAdmin = async (req, res) => {
  try {
    const result = await listAdminOrders(req.query);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
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
    const order = await updateAdminOrderStatus(
      req.params.id,
      String(req.body?.status || ''),
      req.body?.cancellationReason,
    );
    res.json({ success: true, order });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
};

module.exports = { listAdmin, listCustomer, updateAdminStatus };
