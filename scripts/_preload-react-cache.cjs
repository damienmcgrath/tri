/**
 * CommonJS preload that polyfills `react.cache` for scripts run outside a
 * Next.js RSC context. `lib/athlete-context.ts` wraps its exported function
 * with `cache(...)` at module load; without this shim any script that
 * transitively imports that module throws `cache is not a function`.
 *
 * Semantically, `react.cache` dedupes a function per-render. A script has no
 * render, so pass-through is correct — every call runs.
 *
 * Intercepts `require("react")` at the module loader level so the patch is
 * applied before any ESM/CJS consumer captures a binding to `cache`.
 */
const Module = require("module");
const originalResolve = Module._resolveFilename;
const originalLoad = Module._load;

Module._load = function patchedLoad(request, parent, ...rest) {
  const mod = originalLoad.call(this, request, parent, ...rest);
  // Some Next.js builds route through "react" or "next/dist/compiled/react",
  // both expose the same shape.
  if ((request === "react" || request === "next/dist/compiled/react") && mod && typeof mod.cache !== "function") {
    mod.cache = (fn) => fn;
  }
  return mod;
};

// Keep _resolveFilename un-monkey-patched; we only need to intercept _load.
void originalResolve;
