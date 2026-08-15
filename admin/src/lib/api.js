import axios from "axios";
import { getToken, clearToken } from "./auth";

const API = `${import.meta.env.VITE_API_URL}/api`;

const client = axios.create({ baseURL: API });

client.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

client.interceptors.response.use(
  (response) => response,
  (error) => {
    // Clear a stale/expired token, but don't force-navigate here - a 401 is
    // also the normal response to a *failed login attempt itself* (wrong
    // password), and hard-redirecting on every 401 was blowing away the
    // login form (and its error message) via a full page reload before it
    // ever got to render "wrong password". Let the caller's own catch
    // block show the error; route guards handle redirecting for a 401 hit
    // elsewhere in the app (expired session).
    if (error.response?.status === 401) {
      clearToken();
    }
    return Promise.reject(error);
  }
);

export default client;
export { API };
