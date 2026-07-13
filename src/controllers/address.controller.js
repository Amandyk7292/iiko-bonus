const {
  deleteCustomerAddress,
  listCustomerAddresses,
  saveCustomerAddress,
  setDefaultCustomerAddress,
} = require('../services/address.service');

const sendError = (res, error) =>
  res
    .status(error.statusCode || 500)
    .json({ error: error.statusCode ? error.message : 'Не удалось обработать адрес' });

const list = async (req, res) => {
  try {
    const addresses = await listCustomerAddresses(req.customerAuth.id);
    res.set('Cache-Control', 'private, no-store');
    res.json({ success: true, addresses });
  } catch (error) {
    sendError(res, error);
  }
};

const create = async (req, res) => {
  try {
    const address = await saveCustomerAddress(req.customerAuth.id, req.body);
    res.status(201).json({ success: true, address });
  } catch (error) {
    sendError(res, error);
  }
};

const update = async (req, res) => {
  try {
    const address = await saveCustomerAddress(req.customerAuth.id, req.body, req.params.id);
    res.json({ success: true, address });
  } catch (error) {
    sendError(res, error);
  }
};

const remove = async (req, res) => {
  try {
    await deleteCustomerAddress(req.customerAuth.id, req.params.id);
    const addresses = await listCustomerAddresses(req.customerAuth.id);
    res.json({ success: true, addresses });
  } catch (error) {
    sendError(res, error);
  }
};

const setDefault = async (req, res) => {
  try {
    const address = await setDefaultCustomerAddress(req.customerAuth.id, req.params.id);
    res.json({ success: true, address });
  } catch (error) {
    sendError(res, error);
  }
};

module.exports = { create, list, remove, setDefault, update };
