// Native Node 24 synchronous ESM resolution. Only extensionless relative
// source imports need TypeScript fallback; packages and explicit extensions
// remain under Node's own resolution and export-map authority.
import { registerHooks } from "node:module";
import { posix } from "node:path";

const missing = new Set(["ERR_MODULE_NOT_FOUND", "ERR_UNSUPPORTED_DIR_IMPORT"]);
const extensions = [".ts", ".tsx", ".js", "/index.ts", "/index.tsx"];

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (!missing.has(error.code) ||
          !/^\.\.?\//.test(specifier) ||
          /[?#\\]/.test(specifier) ||
          posix.extname(specifier) !== "") {
        throw error;
      }
      const candidates = error.code === "ERR_UNSUPPORTED_DIR_IMPORT"
        ? extensions.filter(extension => extension.startsWith("/"))
        : extensions;
      for (const extension of candidates) {
        try {
          return nextResolve(specifier + extension, context);
        } catch (candidateError) {
          if (!missing.has(candidateError.code)) throw candidateError;
        }
      }
      throw error;
    }
  },
});
