const {
  listAdminOrders,
  listCustomerOrders,
  markCustomerArrived,
  cancelCustomerOrder,
  updateAdminOrderStatus,
} = require('../services/customer-order.service');
const { branchScopeForAdmin } = require('../utils/admin-scope.util');

const branchScopeFor = (req) => branchScopeForAdmin(req.admin);

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
    const branchIds = branchScopeFor(req);
    const result = await listAdminOrders({ ...req.query, branchIds });
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

const markArrived = async (req, res) => {
  try {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        req.params.id,
      )
    ) {
      return res.status(400).json({ success: false, error: 'Некорректный идентификатор заказа' });
    }
    const order = await markCustomerArrived(req.customerAuth.id, req.params.id);
    return res.json({ success: true, order });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      error: error.statusCode ? error.message : 'Не удалось сообщить о прибытии',
    });
  }
};

const cancelCustomer = async (req, res) => {
  try {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        req.params.id,
      )
    ) {
      return res.status(400).json({ success: false, error: 'Некорректный идентификатор заказа' });
    }
    const order = await cancelCustomerOrder(req.customerAuth.id, req.params.id);
    return res.json({ success: true, order });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      error: error.statusCode ? error.message : 'Не удалось отменить заказ',
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
    if (
      requestedStatus === 'cancelled' &&
      !['admin', 'owner', 'branch_manager'].includes(req.admin?.role)
    ) {
      return res.status(403).json({
        error: 'Отмена с возвратом доступна владельцу или управляющему филиалом',
      });
    }
    const order = await updateAdminOrderStatus(
      req.params.id,
      requestedStatus,
      req.body?.cancellationReason,
      {
        branchIds: branchScopeFor(req),
        admin: req.admin,
      },
    );
    res.json({ success: true, order });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      error: error.statusCode ? error.message : 'Не удалось изменить статус заказа',
      code: error.statusCode ? error.code : undefined,
    });
  }
};

module.exports = { listAdmin, listCustomer, markArrived, cancelCustomer, updateAdminStatus };
