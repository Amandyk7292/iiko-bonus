const realtime = require('./realtime.service');
const { validateAdminSession } = require('./admin-session.service');
const { ROLE_AREAS } = require('../middlewares/auth.middleware');
const {
  applyAdminBranchSelection,
  hasGlobalBranchAccess,
  normalizeBranchIds,
} = require('../utils/admin-scope.util');

const streamIdentity = (admin) => ({
  admin: true,
  role: admin.role,
  areas: [...(ROLE_AREAS[admin.role] || [])],
  branchIds: hasGlobalBranchAccess(admin) ? [] : normalizeBranchIds(admin.branchIds),
  selectedBranchId: admin.selectedBranchId || null,
  selectedBranchIds: normalizeBranchIds(admin.selectedBranchIds),
  globalBranchAccess: hasGlobalBranchAccess(admin),
  sessionJti: admin.jti,
  adminSubject: admin.sub,
  expiresAt: admin.sessionExpiresAt || null,
});

function createAdminStream({ validateSession = validateAdminSession } = {}) {
  return function openAdminStream(req, res) {
    const original = req.admin;
    const selection = original.selectedBranchId || '';
    const selections = selection ? '' : normalizeBranchIds(original.selectedBranchIds).join(',');
    return realtime.openStream(req, res, {
      ...streamIdentity(original),
      authorize: async () => {
        const current = await validateSession(original);
        const areas = ROLE_AREAS[current?.role];
        if (!current || !areas || (!areas.has('*') && !areas.has('events'))) return null;
        return streamIdentity(applyAdminBranchSelection(current, selection, selections));
      },
    });
  };
}

module.exports = { openAdminStream: createAdminStream(), createAdminStream };
