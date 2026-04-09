import axios from "axios";
import { API_URL } from "../utils/constants";
import { useAuthStore } from "../stores/authStore";

const apiClient = axios.create({
  baseURL: API_URL,
  timeout: 30000,
  headers: { "Content-Type": "application/json" },
});

// Attach JWT to every request
apiClient.interceptors.request.use((config) => {
  const jwt = useAuthStore.getState().jwt;
  if (jwt) {
    config.headers.Authorization = `Bearer ${jwt}`;
  }
  return config;
});

// Handle 401 → attempt refresh
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      const { userId, refreshAuth, logout } = useAuthStore.getState();
      if (userId) {
        try {
          await refreshAuth();
          const newJwt = useAuthStore.getState().jwt;
          originalRequest.headers.Authorization = `Bearer ${newJwt}`;
          return apiClient(originalRequest);
        } catch {
          logout();
        }
      }
    }

    return Promise.reject(error);
  }
);

export default apiClient;
