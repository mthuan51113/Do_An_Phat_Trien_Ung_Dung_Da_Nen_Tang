import { create } from 'axios';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { tokenStorage } from '../../login/shared/storage/secure-token.storage';

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

    return getExpoHost() || (Platform.OS === 'android' ? '10.0.2.2' : 'localhost');
};

const normalizePartnerBaseUrl = (url: string) => {
    const normalized = url.trim().replace(/\/+$/, '');

    if (/\/api\/v1$/i.test(normalized)) return normalized;
    if (/\/api$/i.test(normalized)) return `${normalized}/v1`;
    return `${normalized}/api/v1`;
};

const getBaseUrl = () => {
    const envBaseUrl = process.env.EXPO_PUBLIC_API_URL?.trim();
    if (envBaseUrl) return normalizePartnerBaseUrl(envBaseUrl);

    return `http://${getDefaultApiHost()}:${API_PORT}/api/v1`;
};

const apiInstance = create({
    baseURL: getBaseUrl(),
    timeout: 10000,
});

apiInstance.interceptors.request.use(
    async (config) => {
        const token = await tokenStorage.getAccessToken();
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
    },
    (error) => {
        return Promise.reject(error);
    }
);

apiInstance.interceptors.response.use(
    (response) => {
        
        return response.data;
    },
    (error) => {
        console.error('Lỗi API:', error.response?.data || error.message);
        return Promise.reject(error);
    }
);
export default apiInstance;
