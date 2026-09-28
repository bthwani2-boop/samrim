import fs from "node:fs";
import path from "node:path";

const ansiColorPattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

function cleanLine(value) {
  return String(value ?? "").replace(ansiColorPattern, "").trim();
}

function artifactLogPath(logPath) {
  return logPath ? `command-logs/${path.basename(logPath)}` : null;
}

function truncate(value, limit = 8192) {
  const text = String(value ?? "");
  return text.length <= limit ? text : `${text.slice(0, limit)}…[TRUNCATED; SEE RAW LOG]`;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function readLogLines(logPath) {
  if (!logPath || !fs.existsSync(logPath)) return [];
  return fs.readFileSync(logPath, "utf8")
    .replace(ansiColorPattern, "")
    .split(/\r?\n/)
    .map((text, index) => ({ lineNumber: index + 1, text: text.trim() }))
    .filter((entry) => entry.text);
}

function classifyFinding(line) {
  const text = line.text;
  const structured = text.match(/\b([A-Z][A-Z0-9_]*)=(FAIL|FAILED|FAILURE)\b/i);
  if (structured) return { kind: "STRUCTURED_FAILURE_MARKER", marker: structured[1].toUpperCase() };
  if (/^::error(?::|\s|$)/i.test(text)) return { kind: "GITHUB_ERROR_ANNOTATION", marker: "GITHUB_ERROR" };
  if (/^--- FAIL:\s+/i.test(text)) return { kind: "GO_TEST_FAILURE", marker: "GO_TEST_FAIL" };
  if (/^FAIL(?:\s|\t|$)/.test(text)) return { kind: "GO_PACKAGE_FAILURE", marker: "GO_PACKAGE_FAIL" };
  if (/\berror TS\d+:/i.test(text)) return { kind: "TYPESCRIPT_ERROR", marker: "TYPESCRIPT_ERROR" };
  if (/^\s*[×✖]\s+/.test(text)) return { kind: "TEST_FAILURE", marker: "TEST_FAILURE" };
  if (/^Found\s+\d+\s+errors?\b/i.test(text)) return { kind: "TOOL_ERROR_SUMMARY", marker: "TOOL_ERROR_SUMMARY" };
  if (/^(?:ERROR|FATAL|PANIC)\s*:/i.test(text)) return { kind: "PROCESS_FATAL", marker: "PROCESS_FATAL" };
  if (/\bexit code\s+[1-9]\d*\b/i.test(text)) return { kind: "NONZERO_EXIT", marker: "NONZERO_EXIT" };
  return null;
}

export function analyzeCommandLog(logPath, sourceCommand = null) {
  const lines = readLogLines(logPath);
  const findings = [];
  const completedTargets = [];
  const failedTargets = [];
  let failedTasksSection = false;

  for (const line of lines) {
    const passTarget = line.text.match(/\bCI_RUNTIME_TASK=PASS\s+target=([^\s]+)/i);
    if (passTarget) completedTargets.push(passTarget[1]);

    const failedTarget = line.text.match(/\bCI_RUNTIME_TASK=FAIL\s+target=([^\s]+)/i);
    if (failedTarget) failedTargets.push(failedTarget[1]);

    if (/^Failed tasks:?$/i.test(line.text)) {
      failedTasksSection = true;
      continue;
    }
    if (failedTasksSection) {
      const target = line.text.match(/^[-*]\s+([A-Za-z0-9._/-]+:[A-Za-z0-9._/-]+)\b/);
      if (target) {
        failedTargets.push(target[1]);
        findings.push({
          kind: "NX_TASK_FAILURE",
          marker: "NX_TASK_FAILED",
          sourceCommand,
          target: target[1],
          lineNumber: line.lineNumber,
          artifactLog: artifactLogPath(logPath),
          evidence: truncate(line.text),
          classification: "UNCLASSIFIED_REQUIRES_CAUSAL_REVIEW",
        });
        continue;
      }
      if (/^(?:Run duration:|See more details|NX\s)/i.test(line.text)) failedTasksSection = false;
    }

    const classified = classifyFinding(line);
    if (!classified) continue;
    findings.push({
      ...classified,
      sourceCommand,
      target: failedTarget?.[1] ?? null,
      lineNumber: line.lineNumber,
      artifactLog: artifactLogPath(logPath),
      evidence: truncate(line.text),
      classification: "UNCLASSIFIED_REQUIRES_CAUSAL_REVIEW",
    });
  }

  const dedupedFindings = [];
  const seen = new Set();
  for (const finding of findings) {
    const key = `${finding.sourceCommand}|${finding.target}|${finding.artifactLog}|${finding.lineNumber}|${finding.marker}|${finding.evidence}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dedupedFindings.push(finding);
  }

  return {
    findings: dedupedFindings,
    completedTargets: unique(completedTargets),
    failedTargets: unique(failedTargets),
  };
}

export function buildAgentDiagnostic({ metadata, metricRecords = [], externalRecords = [], runtimeFailure = null }) {
  const successfulRecords = metricRecords.filter((record) => Number(record.exitCode) === 0);
  const failedRecords = metricRecords.filter((record) => Number(record.exitCode) !== 0);
  const materialFindings = [];
  const completedTargets = [];
  const failedTargets = [];
  const evidenceGroups = [];

  for (const record of metricRecords) {
    const analysis = analyzeCommandLog(record.logPath, record.name);
    completedTargets.push(...analysis.completedTargets);
    if (Number(record.exitCode) !== 0) {
      failedTargets.push(...analysis.failedTargets);
      materialFindings.push(...analysis.findings);
      evidenceGroups.push({
        source: "command",
        command: record.name,
        targets: analysis.failedTargets,
        findingCount: analysis.findings.length,
        artifactLog: artifactLogPath(record.logPath),
      });
    }
  }

  if (runtimeFailure?.target) failedTargets.push(runtimeFailure.target);

  const externalResults = externalRecords.map((record) => ({
    name: record.name ?? "unknown-external-action",
    outcome: record.outcome ?? "unknown",
    source: record.source ?? null,
    observedAt: record.observedAt ?? null,
  }));
  const externalFailures = externalResults.filter((record) => !["success", "skipped"].includes(record.outcome));
  for (const record of externalFailures) {
    materialFindings.push({
      kind: "EXTERNAL_ACTION_FAILURE",
      marker: "EXTERNAL_ACTION_FAIL",
      sourceCommand: record.name,
      target: null,
      lineNumber: null,
      artifactLog: null,
      evidence: `external action ${record.name} outcome=${record.outcome} source=${record.source ?? "unknown"}`,
      classification: "UNCLASSIFIED_REQUIRES_CAUSAL_REVIEW",
    });
    evidenceGroups.push({ source: "external-action", command: record.name, targets: [], findingCount: 1, artifactLog: null });
  }

  if (materialFindings.length === 0) {
    for (const record of failedRecords) {
      materialFindings.push({
        kind: "UNSTRUCTURED_COMMAND_FAILURE",
        marker: "COMMAND_EXIT_NONZERO",
        sourceCommand: record.name,
        target: null,
        lineNumber: null,
        artifactLog: artifactLogPath(record.logPath),
        evidence: `command exited nonzero: ${record.name} exit=${record.exitCode}`,
        classification: "UNCLASSIFIED_REQUIRES_CAUSAL_REVIEW",
      });
    }
  }

  const finalFailedTargets = unique(failedTargets);
  const reproofHints = finalFailedTargets.length > 0
    ? finalFailedTargets
    : unique([...failedRecords.map((record) => record.name), ...externalFailures.map((record) => record.name)]);

  return {
    schema: 2,
    artifactClass: "AGENT_FAILURE_DIAGNOSTIC",
    diagnosticAuthority: "EVIDENCE_ONLY_NOT_ROOT_CAUSE_AUTHORITY",
    candidate: metadata.sha ?? null,
    gate: metadata.kind ?? "unknown",
    workflow: metadata.workflow ?? null,
    job: metadata.job ?? null,
    runId: metadata.runId ?? null,
    runAttempt: metadata.runAttempt ?? null,
    nxBase: metadata.nxBase ?? null,
    nxHead: metadata.nxHead ?? null,
    progressionBlocked: true,
    rootCauseStatus: "UNCLASSIFIED_REQUIRES_CAUSAL_REVIEW",
    failedCommands: failedRecords.map((record) => ({
      name: record.name,
      exitCode: record.exitCode,
      durationMs: record.durationMs ?? null,
      artifactLog: artifactLogPath(record.logPath),
    })),
    successfulCommands: successfulRecords.map((record) => ({
      name: record.name,
      durationMs: record.durationMs ?? null,
      evidenceReuse: "REUSE_WHILE_MATERIAL_INPUTS_REMAIN_UNAFFECTED",
    })),
    completedTargets: unique(completedTargets),
    failedTargets: finalFailedTargets,
    externalResults,
    materialFindings,
    evidenceGroups,
    reproofHints,
    agentProtocol: [
      "FREEZE_UNRELATED_MATERIAL_PROGRESSION",
      "READ_ALL_MATERIAL_FINDINGS_FROM_THIS_BOUNDED_BATCH",
      "COLLAPSE_FINDINGS_BY_HIGHEST_COMMON_CAUSAL_ROOT",
      "PRESERVE_STRONGER_ORACLE_AND_PROVE_PROOF_DEFECT_BEFORE_EDITING_PROOF_OWNER",
      "REPAIR_CANONICAL_ROOTS_IN_ONE_COHERENT_BATCH_WHERE_SAFE",
      "RUN_SMALLEST_FALSIFYING_PROOF",
      "REUSE_UNAFFECTED_PASS_EVIDENCE_VIA_NX_INPUTS_HASHES_CACHE",
      "RERUN_ONLY_MATERIALLY_INVALIDATED_EVIDENCE",
    ],
    rawEvidence: {
      commandLogs: unique(metricRecords.map((record) => artifactLogPath(record.logPath))),
      nxProfiles: unique(metricRecords.map((record) => record.profilePath ? `nx-profiles/${path.basename(record.profilePath)}` : null)),
    },
  };
}
