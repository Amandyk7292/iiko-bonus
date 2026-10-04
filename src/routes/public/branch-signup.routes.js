const path = require('node:path');
const express = require('express');
const { supabase } = require('../../config/supabase');
const { registrationAuthMiddleware } = require('../../middlewares/customer-auth.middleware');
const { authRateLimit } = require('../../middlewares/rate-limit.middleware');
const { z, emptyBodySchema, validateRequest } = require('../../middlewares/validation.middleware');
const { sendApiError } = require('../../utils/http.util');
const { claimBranch } = require('../../services/branch-signup.service');
const branchParams = z.object({ branch: z.string().uuid() }).strict();
const root = path.resolve(__dirname, '../../../public/branch-invite');

function registerBranchSignupRoutes(router) {
  router.use('/branch-invite-assets', express.static(root, { index: false, maxAge: '1h' }));
  router.get('/invite/:branch', validateRequest({ params: branchParams }), (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.redirect(302, '/profile?register=1');
  });
  router.get(
    '/api/branch-invites/:branch',
    validateRequest({ params: branchParams }),
    async (req, res) => {
      try {
        const { data, error } = await supabase
          .from('bulka_locations')
          .select('id,name,city,address')
          .eq('id', req.params.branch)
          .eq('active', true)
          .maybeSingle();
        if (error) throw error;
        if (!data) return res.status(404).json({ success: false, error: 'Точка недоступна' });
        res.set('Cache-Control', 'no-store');
        res.json({ success: true, branch: data });
      } catch (error) {
        sendApiError(res, error);
      }
    },
  );
  router.post(
    '/api/branch-invites/:branch/claim',
    authRateLimit,
    registrationAuthMiddleware,
    validateRequest({ params: branchParams, body: emptyBodySchema }),
    async (req, res) => {
      try {
        const result = await claimBranch(req.registrationAuth.phone, req.params.branch);
        res.set('Cache-Control', 'no-store');
        res.json({ success: true, ...result });
      } catch (error) {
        sendApiError(res, error);
      }
    },
  );
}
module.exports = { registerBranchSignupRoutes, branchParams };
