import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const candidatesByPlatform = {
  win32: {
    git: [
      String.raw`C:\Program Files\Git\cmd\git.exe`,
      String.raw`C:\Program Files (x86)\Git\cmd\git.exe`,
    ],
    docker: [
      String.raw`C:\Program Files\Docker\Docker\resources\bin\docker.exe`,
      String.raw`C:\Program Files (x86)\Docker\Docker\resources\bin\docker.exe`,
    ],
    go: [String.raw`C:\Program Files\Go\bin\go.exe`],
    gofmt: [String.raw`C:\Program Files\Go\bin\gofmt.exe`],
    pwsh: [String.raw`C:\Program Files\PowerShell\7\pwsh.exe`],
  },
  linux: {
    git: ["/usr/bin/git", "/bin/git"],
    docker: ["/usr/bin/docker", "/bin/docker"],
    go: ["/usr/local/go/bin/go"],
    gofmt: ["/usr/local/go/bin/gofmt"],
    pwsh: ["/usr/bin/pwsh", "/usr/local/bin/pwsh"],
  },
  darwin: {
    git: ["/usr/bin/git"],
    docker: ["/Applications/Docker.app/Contents/Resources/bin/docker"],
    go: ["/usr/local/go/bin/go", "/opt/homebrew/bin/go"],
    gofmt: ["/usr/local/go/bin/gofmt", "/opt/homebrew/bin/gofmt"],
    pwsh: ["/opt/microsoft/powershell/7/pwsh"],
  },
};

function runnerGoCandidates(name) {
  if (process.env.GITHUB_ACTIONS !== "true" || !process.env.RUNNER_TOOL_CACHE) return [];
  const toolCache = process.env.RUNNER_TOOL_CACHE;
  if (!path.isAbsolute(toolCache)) return [];

  const repoRoot = path.resolve(import.meta.dirname, "../../..");
  const workspace = fs.readFileSync(path.join(repoRoot, "go.work"), "utf8");
  const version = /^go\s+(\d+\.\d+(?:\.\d+)?)\s*$/m.exec(workspace)?.[1];
  if (!version) throw new Error("trusted Go version is missing from go.work");

  const architecture = { x64: "x64", arm64: "arm64", ia32: "x86" }[process.arch];
  if (!architecture) throw new Error(`unsupported Go runner architecture: ${process.arch}`);
  return [path.join(toolCache, "go", version, architecture, "bin", process.platform === "win32" ? `${name}.exe` : name)];
}

function windowsPowerShellPackageCandidates() {
  if (process.platform !== "win32" || !process.env.ProgramFiles || !process.env.SystemRoot) return [];
  const systemPowerShell = path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  try {
    const trustedSystemPowerShell = fs.realpathSync(systemPowerShell);
    if (!path.isAbsolute(trustedSystemPowerShell) || !fs.statSync(trustedSystemPowerShell).isFile()) return [];
    const installLocation = execFileSync(trustedSystemPowerShell, [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "(Get-AppxPackage -Name Microsoft.PowerShell | Sort-Object Version -Descending | Select-Object -First 1 -ExpandProperty InstallLocation)",
    ], { encoding: "utf8", windowsHide: true }).trim();
    if (!installLocation) return [];

    const trustedPackageRoot = fs.realpathSync(path.join(process.env.ProgramFiles, "WindowsApps"));
    const trustedInstallLocation = fs.realpathSync(installLocation);
    const relative = path.relative(trustedPackageRoot, trustedInstallLocation);
    if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(".." + path.sep)) return [];
    return [path.join(trustedInstallLocation, "pwsh.exe")];
  } catch {
    return [];
  }
}

export function resolveTrustedExecutable(name) {
  const fixedCandidates = candidatesByPlatform[process.platform]?.[name];
  const runnerManaged = name === "go" || name === "gofmt" || name === "pwsh";
  if (!fixedCandidates && !runnerManaged) throw new Error(`executable is not on the trusted allowlist: ${name}`);

  const candidates = [
    ...(name === "go" || name === "gofmt" ? runnerGoCandidates(name) : []),
    ...(fixedCandidates ?? []),
    ...(name === "pwsh" ? windowsPowerShellPackageCandidates() : []),
  ];
  if (!candidates) throw new Error(`executable is not on the trusted allowlist: ${name}`);

  for (const candidate of candidates) {
    try {
      const resolved = fs.realpathSync(candidate);
      if (path.isAbsolute(resolved) && fs.statSync(resolved).isFile()) return resolved;
    } catch {
      // Continue only through the fixed system installation locations above.
    }
  }

  throw new Error(`trusted ${name} executable was not found in a fixed system installation directory or configured GitHub Go tool cache`);
}
