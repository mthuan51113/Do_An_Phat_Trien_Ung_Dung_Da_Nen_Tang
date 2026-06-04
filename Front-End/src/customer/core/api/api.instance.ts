import { create, type InternalAxiosRequestConfig } from 'axios';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { ApiResponse } from '@/src/customer/core/types/api.types';

type RetryableRequestConfig = InternalAxiosRequestConfig & {
  _retry?: boolean;
};

const getStoredItem = async (key: string) => {
  if (Platform.OS === 'web') {
    return localStorage.getItem(key);
  }

  return SecureStore.getItemAsync(key);
};

const setStoredItem = async (key: string, value: string) => {
  if (Platform.OS === 'web') {
    localStorage.setItem(key, value);
    return;
  }

  await SecureStore.setItemAsync(key, value);
};

const removeStoredItem = async (key: string) => {
  if (Platform.OS === 'web') {
    localStorage.removeItem(key);
    return;
  }

  await SecureStore.deleteItemAsync(key);
};

const clearStoredAuth = async () => {
  await Promise.all([
    removeStoredItem('accessToken'),
    removeStoredItem('refreshToken'),
    removeStoredItem('user'),
  ]);
};

const API_PORT = process.env.EXPO_PUBLIC_API_PORT || '5000';

const getHostFromUri = (uri?: string | null) => {
  if (!uri) return null;

  const withoutProtocol = uri.replace(/^[a-z]+:\/\//i, '');
  return withoutProtocol.split('/')[0]?.split(':')[0] || null;
};

const getExpoHost = () => {
  const constants = Constants as any;
  const candidateUris = [
    constants.expoConfig?.hostUri,
    constants.manifest?.debuggerHost,
    constants.manifest?.hostUri,
    constants.manifest2?.extra?.expoClient?.hostUri,
    constants.manifest2?.extra?.expoGo?.debuggerHost,
  ];

  for (const uri of candidateUris) {
    const host = getHostFromUri(uri);
    if (host) return host;
  }

  return null;
};

const getWebHost = () => {
  if (typeof window === 'undefined') return null;
  return window.location.hostname || null;
};

const getDefaultApiHost = () => {
  if (Platform.OS === 'web') {
    const webHost = getWebHost();
    if (webHost && webHost !== '0.0.0.0') return webHost;
  }

  return (
    getExpoHost() || (Platform.OS === 'android' ? '10.0.2.2' : 'localhost')
  );
};

const normalizeCustomerBaseUrl = (url: string) =>
  url.trim().replace(/\/+$/, '').replace(/\/api$/i, '');

const getBaseUrl = () => {
  const envBaseUrl = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (envBaseUrl) return normalizeCustomerBaseUrl(envBaseUrl);

  return `http://${getDefaultApiHost()}:${API_PORT}`;
};

const baseURL = getBaseUrl();
console.log('CUSTOMER API BASE URL:', baseURL);

const apiInstance = create({
  baseURL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 10000,
});

apiInstance.interceptors.request.use(async (config) => {
  let token: string | null = null;

  try {
    token =
      Platform.OS === 'web'
        ? localStorage.getItem('accessToken')
        : await SecureStore.getItemAsync('accessToken');
  } catch (err) {
    console.log('Lỗi khi lấy accessToken:', err);
  }

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

apiInstance.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config as RetryableRequestConfig | undefined;

    console.log('AXIOS ERROR STATUS:', error.response?.status);
    console.log('AXIOS ERROR URL:', error.config?.url);
    console.log('AXIOS ERROR METHOD:', error.config?.method);
    console.log('AXIOS ERROR DATA:', error.response?.data);

    if (error.response?.status === 401 && !original?._retry) {
      const isAuthEndpoint = original?.url?.includes('/api/customer/auth/');
      const isRefreshEndpoint = original?.url?.includes('/refresh-token');

      if (!original || isRefreshEndpoint) {
        await clearStoredAuth();
        return Promise.reject(error);
      }

      if (isAuthEndpoint) {
        return Promise.reject(error);
      }

      original._retry = true;
      const refreshToken = await getStoredItem('refreshToken');

      if (!refreshToken) {
        await clearStoredAuth();
        return Promise.reject(error);
      }

      try {
        const response = await apiInstance.post<ApiResponse<{ accessToken: string }>>(
          '/api/customer/auth/refresh-token',
          { refreshToken },
        );
        const nextAccessToken = response.data.data.accessToken;
        await setStoredItem('accessToken', nextAccessToken);
        original.headers.Authorization = `Bearer ${nextAccessToken}`;
        return apiInstance(original);
      } catch (refreshError) {
        await clearStoredAuth();
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

export default apiInstance;
