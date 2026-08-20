import React, { createContext, useContext, useState } from 'react';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(localStorage.getItem('org_token'));
  const [orgName, setOrgName] = useState(localStorage.getItem('org_name') || '');
  const [quotaPerUnit, setQuotaPerUnit] = useState(
    parseFloat(localStorage.getItem('quota_per_unit')) || 500000
  );

  const login = (newToken, name) => {
    localStorage.setItem('org_token', newToken);
    localStorage.setItem('org_name', name);
    setToken(newToken);
    setOrgName(name);
  };

  const logout = () => {
    localStorage.removeItem('org_token');
    localStorage.removeItem('org_name');
    localStorage.removeItem('quota_per_unit');
    setToken(null);
    setOrgName('');
  };

  const updateQuotaPerUnit = (val) => {
    localStorage.setItem('quota_per_unit', val);
    setQuotaPerUnit(val);
  };

  return (
    <AuthContext.Provider value={{ token, orgName, quotaPerUnit, login, logout, updateQuotaPerUnit }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
