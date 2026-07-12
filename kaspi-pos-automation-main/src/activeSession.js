let activeTokenSN = null;

export const activateSession = (tokenSN) => {
  activeTokenSN = tokenSN || null;
};

export const clearActiveSession = (tokenSN) => {
  if (!tokenSN || activeTokenSN === tokenSN) activeTokenSN = null;
};

export const isActiveSession = (tokenSN) => !!tokenSN && activeTokenSN === tokenSN;

export const inactiveSessionResponse = () => ({
  error: 'Эта сессия больше не активна. Был выполнен новый вход — войдите заново в этом профиле.',
  code: 'KASPI_SESSION_REPLACED',
});
