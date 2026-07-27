const contactCenter = require('../../services/contact-center.service');

const sendContactError = (res, error) =>
  res.status(error.statusCode || 500).json({
    success: false,
    error: error.message,
    ...(error.code && { code: error.code }),
  });

const registerContactCenterAdminRoutes = (router) => {
  router.get('/admin/api/contact-cards', async (_req, res) => {
    try {
      res.json({ success: true, cards: await contactCenter.listAdminContactCards() });
    } catch (error) {
      sendContactError(res, error);
    }
  });

  router.post('/admin/api/contact-cards', async (req, res) => {
    try {
      res.status(201).json({
        success: true,
        card: await contactCenter.createContactCard(req.body),
      });
    } catch (error) {
      sendContactError(res, error);
    }
  });

  router.put('/admin/api/contact-cards/reorder', async (req, res) => {
    try {
      res.json({
        success: true,
        cards: await contactCenter.reorderContactCards(req.body?.ids),
      });
    } catch (error) {
      sendContactError(res, error);
    }
  });

  router.put('/admin/api/contact-cards/:id', async (req, res) => {
    try {
      res.json({
        success: true,
        card: await contactCenter.updateContactCard(req.params.id, req.body),
      });
    } catch (error) {
      sendContactError(res, error);
    }
  });

  router.delete('/admin/api/contact-cards/:id', async (req, res) => {
    try {
      await contactCenter.deleteContactCard(req.params.id);
      res.json({ success: true });
    } catch (error) {
      sendContactError(res, error);
    }
  });

  router.post('/admin/api/contact-cards/:cardId/actions', async (req, res) => {
    try {
      res.status(201).json({
        success: true,
        action: await contactCenter.createContactAction(req.params.cardId, req.body),
      });
    } catch (error) {
      sendContactError(res, error);
    }
  });

  router.put('/admin/api/contact-cards/:cardId/actions/reorder', async (req, res) => {
    try {
      res.json({
        success: true,
        actions: await contactCenter.reorderContactActions(req.params.cardId, req.body?.ids),
      });
    } catch (error) {
      sendContactError(res, error);
    }
  });

  router.put('/admin/api/contact-actions/:id', async (req, res) => {
    try {
      res.json({
        success: true,
        action: await contactCenter.updateContactAction(req.params.id, req.body),
      });
    } catch (error) {
      sendContactError(res, error);
    }
  });

  router.delete('/admin/api/contact-actions/:id', async (req, res) => {
    try {
      await contactCenter.deleteContactAction(req.params.id);
      res.json({ success: true });
    } catch (error) {
      sendContactError(res, error);
    }
  });
};

module.exports = { registerContactCenterAdminRoutes };
