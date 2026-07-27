import { getGlobalSession } from './sessionStorage.js';

let activeTokenSN = null;

export const activateSession = (tokenSN) => {
  activeTokenSN = tokenSN || null;
};

export const clearActiveSession = (tokenSN) => {
  if (!tokenSN || activeTokenSN === tokenSN) activeTokenSN = null;
};

export const isActiveSession = (tokenSN) => {
  if (activeTokenSN === tokenSN) return true;
  const global = getGlobalSession();
  if (global && global.tokenSN === tokenSN) return true;
  return false;
};

export const inactiveSessionResponse = () => ({
  error: 'Kaspi Pay требует повторного входа администратора.',
  code: 'KASPI_REAUTH_REQUIRED',
  retryable: false,
});
