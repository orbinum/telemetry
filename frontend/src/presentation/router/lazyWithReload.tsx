/**
 * A deploy rotates the hashed chunk names, but an open tab keeps the old
 * index.html in memory. Its next lazy import asks for a bundle that no longer
 * exists, Pages answers the SPA fallback with index.html, and the browser
 * reports:
 *
 *   Failed to load module script: Expected a JavaScript-or-Wasm module script
 *   but the server responded with a MIME type of "text/html".
 *
 * One reload fetches the current index.html and the new hash resolves. So the
 * first failure reloads; a failure that survives a reload is not staleness
 * (an ad blocker taking out the request looks identical from here) and
 * reloading again would only loop, so that one is rethrown for the caller's
 * errorElement to render.
 */

const RELOADED_KEY = "chunk-reload";

export function lazyWithReload<T>(load: () => Promise<T>): () => Promise<T> {
  return async () => {
    try {
      const mod = await load();
      sessionStorage.removeItem(RELOADED_KEY);
      return mod;
    } catch (error) {
      if (sessionStorage.getItem(RELOADED_KEY)) throw error;
      sessionStorage.setItem(RELOADED_KEY, "1");
      window.location.reload();
      // The reload is async; block instead of returning a half-loaded route.
      return await new Promise<T>(() => {});
    }
  };
}
