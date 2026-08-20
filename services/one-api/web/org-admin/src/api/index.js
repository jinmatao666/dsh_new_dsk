import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || process.env.PUBLIC_URL || '';

const api = axios.create({
  baseURL: `${API_URL}/org-api`,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('org_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      localStorage.removeItem('org_token');
      localStorage.removeItem('org_name');
      window.location.href = `${process.env.PUBLIC_URL || ''}/login`;
    }
    return Promise.reject(error);
  }
);

export default api;
