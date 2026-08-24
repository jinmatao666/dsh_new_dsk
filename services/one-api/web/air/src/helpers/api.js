import axios from 'axios';

export const API = axios.create({
  baseURL: process.env.REACT_APP_SERVER ? process.env.REACT_APP_SERVER : '',
});

API.interceptors.response.use(
  (response) => response,
  // 由具体页面决定是否提示错误。这里再次弹 Toast 会和页面 catch
  // 中的提示叠加，导致后台加载时出现多层重复错误。
  (error) => Promise.reject(error)
);
