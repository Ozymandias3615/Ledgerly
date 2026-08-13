import axios from "axios";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const client = axios.create({
  baseURL: API,
  withCredentials: true,
});

// Most call sites fire requests fire-and-forget (no .catch), so a 401 from an
// expired session becomes an unhandled promise rejection that floods Sentry
// and leaves the page stuck (e.g. "Loading..." forever). Handle expired
// sessions centrally instead: broadcast so AuthContext can flip the user to
// logged-out (existing route guards then redirect to /login), and never
// settle the promise so .then/await callbacks don't run against a response
// that will never come. /auth/* is excluded since those calls (login,
// register, checkAuth) already handle their own 401s deliberately.
client.interceptors.response.use(
  (response) => response,
  (error) => {
    const isAuthEndpoint = error.config?.url?.startsWith("/auth");
    if (error.response?.status === 401 && !isAuthEndpoint) {
      window.dispatchEvent(new Event("auth:unauthorized"));
      return new Promise(() => {});
    }
    return Promise.reject(error);
  },
);

export default client;
export { API };
