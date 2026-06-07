import axios from 'axios';

// 建立 Axios 實例
const apiClient = axios.create({
  baseURL: '/api', // 配合 Vite Proxy
  timeout: 10000,
});

// 請求攔截器：自動帶上 Token
apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('qrtalkieAdminToken') || sessionStorage.getItem('qrtalkieAdminToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// 回應攔截器：自動解構資料與統一錯誤處理
apiClient.interceptors.response.use(
  (response) => response.data,
  (error) => {
    if (error.response && error.response.status === 401) {
      localStorage.removeItem('qrtalkieAdminToken');
      sessionStorage.removeItem('qrtalkieAdminToken');
      window.location.reload(); // 登入過期，重整頁面讓 App.jsx 將使用者導回首頁
    }
    const data = error.response?.data || {};
    const errorMessage = data.message || error.message || '發生未知的錯誤';
    const err = new Error(errorMessage);
    err.code = data.code;
    err.status = error.response?.status;
    err.data = data;
    return Promise.reject(err);
  }
);

export default apiClient;
