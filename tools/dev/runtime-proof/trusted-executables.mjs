import fs from "node:fs";
import path from "node:path";

const candidatesByPlatform = {
  win32: {
    git: [
      "C:\\Program Files\\Git\\cmd\\git.exe",
      "C:\\Program Files (x86)\\Git\\cmd\\git.exe",
    ],
    docker: [
      "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe",
      "C:\\Program Files (x86)\\Docker\\Docker\\resources\\bin\\docker.exe",
    ],
  },
  linux: {
    git: ["/usr/bin/git", "/bin/git"],
    docker: ["/usr/bin/docker", "/bin/docker"],
  },
  darwin: {
    git: ["/usr/bin/git"],
    docker: ["/Applications/Docker.app/Contents/Resources/bin/docker"],
  },
};

export function resolveTrustedExecutable(name) {
  const candidates = candidatesByPlatform[process.platform]?.[name];
  if (!candidates) throw new Error(`executable is not on the trusted allowlist: ${name}`);

  for (const candidate of candidates) {
    try {
      const resolved = fs.realpathSync(candidate);
      if (path.isAbsolute(resolved) && fs.statSync(resolved).isFile()) return resolved;
    } catch {
      // Continue only through the fixed system installation locations above.
    }
  }

  throw new Error(`trusted ${name} executable was not found in a fixed system installation directory`);
}
