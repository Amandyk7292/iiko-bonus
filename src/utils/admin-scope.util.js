const NO_BRANCH_SCOPE = '00000000-0000-0000-0000-000000000000';
const GLOBAL_BRANCH_ROLES = new Set(['owner', 'admin']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const normalizeBranchIds = (value) =>
  Array.from(
    new Set(
      (Array.isArray(value) ? value : [])
        .map((branchId) => String(branchId || '').trim())
        .filter(Boolean),
    ),
  );

const hasGlobalBranchAccess = (admin) => GLOBAL_BRANCH_ROLES.has(String(admin?.role || ''));

const branchScopeForAdmin = (admin) => {
  const selectedBranchIds = normalizeBranchIds(admin?.selectedBranchIds);
  if (selectedBranchIds.length) return selectedBranchIds;
  const selectedBranchId = String(admin?.selectedBranchId || '').trim();
  if (selectedBranchId) return [selectedBranchId];
  if (hasGlobalBranchAccess(admin)) return [];
  const branchIds = normalizeBranchIds(admin?.branchIds);
  // Empty means unrestricted in Supabase query helpers. Never return it for a
  // restricted role, otherwise an unassigned operator would see every branch.
  return branchIds.length ? branchIds : [NO_BRANCH_SCOPE];
};

const applyAdminBranchSelection = (admin, value, multipleValue = '') => {
  const selectedBranchId = String(value || '').trim();
  const rawMultipleValue = String(multipleValue || '').trim();
  if (selectedBranchId && rawMultipleValue) {
    throw Object.assign(new Error('Некорректный филиал'), { statusCode: 400 });
  }
  const requestedBranchIds = selectedBranchId
    ? [selectedBranchId]
    : normalizeBranchIds(rawMultipleValue.split(','));
  if (!selectedBranchId && rawMultipleValue && requestedBranchIds.length === 0) {
    throw Object.assign(new Error('Некорректные филиалы'), { statusCode: 400 });
  }
  if (!requestedBranchIds.length) {
    return { ...admin, selectedBranchId: null, selectedBranchIds: [] };
  }
  if (
    requestedBranchIds.length > 50 ||
    requestedBranchIds.some((branchId) => !UUID_PATTERN.test(branchId))
  ) {
    throw Object.assign(new Error('Некорректные филиалы'), { statusCode: 400 });
  }
  const assignedBranchIds = normalizeBranchIds(admin?.branchIds);
  if (
    !hasGlobalBranchAccess(admin) &&
    requestedBranchIds.some((branchId) => !assignedBranchIds.includes(branchId))
  ) {
    throw Object.assign(new Error('Филиал не входит в область доступа'), { statusCode: 403 });
  }
  return {
    ...admin,
    selectedBranchId: requestedBranchIds.length === 1 ? requestedBranchIds[0] : null,
    selectedBranchIds: requestedBranchIds,
  };
};

module.exports = {
  NO_BRANCH_SCOPE,
  applyAdminBranchSelection,
  branchScopeForAdmin,
  hasGlobalBranchAccess,
  normalizeBranchIds,
};
