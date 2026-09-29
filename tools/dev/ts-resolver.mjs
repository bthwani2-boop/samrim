const extensions = [".ts", ".tsx", ".js", "/index.ts", "/index.tsx"];

async function resolveCandidate(specifier, context, nextResolve, index = 0) {
  if (index >= extensions.length) return null;
  try {
    return await nextResolve(specifier + extensions[index], context);
  } catch {
    return resolveCandidate(specifier, context, nextResolve, index + 1);
  }
}

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (err.code === "ERR_MODULE_NOT_FOUND") {
      const resolved = await resolveCandidate(specifier, context, nextResolve);
      if (resolved) return resolved;
    }
    throw err;
  }
}
