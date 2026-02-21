const VERIFIED_ROLE_KEY = 'urbanflow_verified_role';

export const setVerifiedRole = (role: string) => {
  localStorage.setItem(VERIFIED_ROLE_KEY, role);
};

export const clearVerifiedRole = () => {
  localStorage.removeItem(VERIFIED_ROLE_KEY);
};

export const hasVerifiedRole = (role: string) => {
  return localStorage.getItem(VERIFIED_ROLE_KEY) === role;
};
