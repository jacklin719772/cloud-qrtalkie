export function createSessionStore(storageKey) {
  function getAuthToken() {
    return window.localStorage.getItem(storageKey) || "";
  }

  function setAuthToken(token) {
    if (token) window.localStorage.setItem(storageKey, token);
    else window.localStorage.removeItem(storageKey);
  }

  return { getAuthToken, setAuthToken };
}
