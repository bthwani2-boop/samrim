import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ansiColorPattern = new RegExp(String.raw`${String.fromCodePoint(27)}\[[0-9;]*m`, "g");
const rootCauseUnknown = "UNCLASSIFIED_REQUIRES_CAUSAL_REVIEW";
const compareStrings = (left, right) => String(left).localeCompare(String(right), "en");

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

function stableHash(value, length = 16) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, length);
}

function readLogLines(logPath) {
  if (!logPath || !fs.existsSync(logPath)) return [];
  return fs.readFileSync(logPath, "utf8")
    .replace(ansiColorPattern, "")
    .split(/\r?\n/)
    .map((text, index) => ({ lineNumber: index + 1, text: text.trim() }))
    .filter((entry) => entry.text);
}

function classifyFinding(line) {
  const text = line.text;
  const structured = /\b([A-Z][A-Z0-9_]*)=(FAIL|FAILED|FAILURE)\b/i.exec(text);
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

function ownerHint(target, sourceCommand) {
  if (target?.includes(":")) return target.split(":", 1)[0];
  return sourceCommand ?? "unresolved-owner";
}

function evidenceReference(finding) {
  if (!finding.artifactLog) return null;
  if (!finding.lineNumber) return finding.artifactLog;
  return `${finding.artifactLog}#L${finding.lineNumber}`;
}

function enrichFinding(finding) {
  const causalTarget = finding.causalContextTarget ?? finding.target ?? null;
  const fingerprintBasis = [finding.kind, finding.marker, finding.sourceCommand, finding.target, causalTarget, finding.evidence].join("|");
  const fingerprint = stableHash(fingerprintBasis, 20);
  return {
    id: `F-${fingerprint.slice(0, 12)}`,
    fingerprint,
    tool: finding.sourceCommand ?? null,
    target: finding.target ?? null,
    causalContextTarget: causalTarget,
    claim: finding.target ?? causalTarget ?? finding.marker ?? null,
    owner: ownerHint(causalTarget, finding.sourceCommand),
    severity: "MATERIAL_UNCLASSIFIED",
    class: rootCauseUnknown,
    kind: finding.kind,
    marker: finding.marker,
    evidence: finding.evidence,
    evidenceRefs: unique([evidenceReference(finding)]),
    artifactLog: finding.artifactLog ?? null,
    lineNumber: finding.lineNumber ?? null,
  };
}

function runtimeTaskEvent(text) {
  for (const [kind, pattern] of [
    ["START", /\bCI_RUNTIME_TASK=START\s+target=([^\s]+)/i],
    ["PASS", /\bCI_RUNTIME_TASK=PASS\s+target=([^\s]+)/i],
    ["FAIL", /\bCI_RUNTIME_TASK=FAIL\s+target=([^\s]+)/i],
  ]) {
    const match = pattern.exec(text);
    if (match) return { kind, target: match[1] };
  }
  return null;
}

function applyRuntimeTaskEvent(state, event) {
  if (!event) return;
  if (event.kind === "START") {
    state.activeRuntimeTarget = event.target;
    state.terminalFailedTarget = null;
    return;
  }
  if (event.kind === "PASS") {
    state.completedTargets.push(event.target);
    if (state.activeRuntimeTarget === event.target) state.activeRuntimeTarget = null;
    return;
  }
  state.failedTargets.push(event.target);
  state.terminalFailedTarget = event.target;
  state.activeRuntimeTarget = event.target;
}

function failedNxTarget(text) {
  return /^[-*]\s+([A-Za-z0-9._/-]+:[A-Za-z0-9._/-]+)\b/.exec(text)?.[1] ?? null;
}

export function analyzeCommandLog(logPath, sourceCommand = null) {
  const lines = readLogLines(logPath);
  const findings = [];
  const state = {
    completedTargets: [],
    failedTargets: [],
    activeRuntimeTarget: null,
    terminalFailedTarget: null,
  };
  let failedTasksSection = false;

  for (const line of lines) {
    const runtimeEvent = runtimeTaskEvent(line.text);
    applyRuntimeTaskEvent(state, runtimeEvent);

    if (/^Failed tasks:?$/i.test(line.text)) {
      failedTasksSection = true;
      continue;
    }

    if (failedTasksSection) {
      const target = failedNxTarget(line.text);
      if (target) {
        state.failedTargets.push(target);
        findings.push({
          kind: "NX_TASK_FAILURE",
          marker: "NX_TASK_FAILED",
          sourceCommand,
          target,
          causalContextTarget: state.activeRuntimeTarget ?? state.terminalFailedTarget ?? target,
          lineNumber: line.lineNumber,
          artifactLog: artifactLogPath(logPath),
          evidence: truncate(line.text),
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
      target: runtimeEvent?.kind === "FAIL" ? runtimeEvent.target : state.activeRuntimeTarget,
      causalContextTarget: state.activeRuntimeTarget ?? state.terminalFailedTarget,
      lineNumber: line.lineNumber,
      artifactLog: artifactLogPath(logPath),
      evidence: truncate(line.text),
    });
  }

  const deduped = new Map();
  for (const finding of findings.map(enrichFinding)) {
    if (!deduped.has(finding.fingerprint)) deduped.set(finding.fingerprint, finding);
  }

  return {
    findings: [...deduped.values()],
    completedTargets: unique(state.completedTargets),
    failedTargets: unique(state.failedTargets),
  };
}

function buildCausalGroups(findings) {
  const groups = new Map();
  for (const finding of findings) {
    const key = finding.owner || "unresolved-owner";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(finding.id);
  }

  return [...groups.entries()].map(([owner, findingIds]) => {
    const orderedFindingIds = findingIds.toSorted(compareStrings);
    const groupBasis = `${owner}|${orderedFindingIds.join(",")}`;
    return {
      id: `G-${stableHash(groupBasis, 12)}`,
      rootCandidate: null,
      confidence: "UNCLASSIFIED",
      groupingBasis: "SHARED_CANONICAL_OWNER_HINT_ONLY_NOT_CAUSAL_PROOF",
      findingIds: orderedFindingIds,
      canonicalOwner: owner === "unresolved-owner" ? null : owner,
      requiredInvestigation: [
        "ESTABLISH_STRONGER_INDEPENDENT_ORACLE",
        "PROVE_HIGHEST_COMMON_CAUSAL_ROOT",
        "DO_NOT_PATCH_INDIVIDUAL_SYMPTOMS_BEFORE_CAUSAL_COLLAPSE",
      ],
    };
  });
}

function reproofTargets(runtimeFailure, finalFailedTargets, failedRecords, externalFailures) {
  if (runtimeFailure?.target) return [runtimeFailure.target];
  if (finalFailedTargets.length > 0) return finalFailedTargets;
  return unique([...failedRecords.map((record) => record.name), ...externalFailures.map((record) => record.name)]);
}

export function buildClosureDiagnostic({ metadata, metricRecords = [], externalRecords = [], runtimeFailure = null, affectedProjects = [] }) {
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
    materialFindings.push(enrichFinding({
      kind: "EXTERNAL_ACTION_FAILURE",
      marker: "EXTERNAL_ACTION_FAIL",
      sourceCommand: record.name,
      target: null,
      causalContextTarget: null,
      lineNumber: null,
      artifactLog: null,
      evidence: `external action ${record.name} outcome=${record.outcome} source=${record.source ?? "unknown"}`,
    }));
    evidenceGroups.push({ source: "external-action", command: record.name, targets: [], findingCount: 1, artifactLog: null });
  }

  if (materialFindings.length === 0) {
    for (const record of failedRecords) {
      materialFindings.push(enrichFinding({
        kind: "UNSTRUCTURED_COMMAND_FAILURE",
        marker: "COMMAND_EXIT_NONZERO",
        sourceCommand: record.name,
        target: null,
        causalContextTarget: runtimeFailure?.target ?? null,
        lineNumber: null,
        artifactLog: artifactLogPath(record.logPath),
        evidence: `command exited nonzero: ${record.name} exit=${record.exitCode}`,
      }));
    }
  }

  const uniqueFindings = [...new Map(materialFindings.map((finding) => [finding.fingerprint, finding])).values()];
  const finalCompletedTargets = unique(completedTargets);
  const finalFailedTargets = unique(failedTargets);
  const observedTargets = unique([...finalCompletedTargets, ...finalFailedTargets]);
  const reproofHints = reproofTargets(runtimeFailure, finalFailedTargets, failedRecords, externalFailures);
  const skippedExternal = externalResults.filter((record) => record.outcome === "skipped");

  return {
    schemaVersion: 3,
    artifactClass: "CAUSAL_DIAGNOSTIC_CLOSURE",
    diagnosticAuthority: "EVIDENCE_ONLY_NOT_ROOT_CAUSE_AUTHORITY",
    candidate: {
      sha: metadata.sha ?? null,
      base: metadata.nxBase ?? null,
      head: metadata.nxHead ?? metadata.sha ?? null,
      branch: metadata.branch ?? null,
    },
    gate: metadata.kind ?? "unknown",
    workflow: metadata.workflow ?? null,
    job: metadata.job ?? null,
    runId: metadata.runId ?? null,
    runAttempt: metadata.runAttempt ?? null,
    scope: {
      authority: "GIT_PLUS_NX_TASK_INPUTS_AND_AFFECTED_GRAPH",
      affectedProjects: unique(affectedProjects),
      observedTargets,
      materialInputs: {
        nxBase: metadata.nxBase ?? null,
        nxHead: metadata.nxHead ?? metadata.sha ?? null,
      },
    },
    execution: {
      reason: "REQUIRED_PROOF_FAILED_ON_EXACT_CANDIDATE",
      selectedProofs: metricRecords.map((record) => record.name),
      successfulProofs: successfulRecords.map((record) => record.name),
      failedProofs: failedRecords.map((record) => record.name),
      skippedProofs: skippedExternal.map((record) => record.name),
      skipReasons: Object.fromEntries(skippedExternal.map((record) => [record.name, "EXTERNAL_ACTION_NOT_APPLICABLE_OR_SKIPPED"])),
      boundedFailureHarvest: true,
    },
    findings: uniqueFindings,
    causalGroups: buildCausalGroups(uniqueFindings),
    closure: {
      progressionBlocked: true,
      rootCauseStatus: rootCauseUnknown,
      highestPriorityRoot: null,
      smallestFalsifyingProof: reproofHints,
      invalidatedEvidence: [],
      completionCondition: "ZERO_PROVEN_CAUSAL_ROOTS_REMAIN_AND_ALL_MATERIALLY_INVALIDATED_REQUIRED_EVIDENCE_IS_GREEN",
    },
    reusableEvidence: successfulRecords.map((record) => ({
      proof: record.name,
      durationMs: record.durationMs ?? null,
      validity: "REUSE_WHILE_MATERIAL_INPUTS_REMAIN_UNAFFECTED",
    })),
    completedTargets: finalCompletedTargets,
    failedTargets: finalFailedTargets,
    externalResults,
    evidenceGroups,
    agentProtocol: [
      "FREEZE_UNRELATED_MATERIAL_PROGRESSION",
      "READ_ALL_FINDINGS_FROM_THIS_BOUNDED_BATCH_BEFORE_REPAIR",
      "DEDUPLICATE_CORRELATE_AND_COLLAPSE_BY_HIGHEST_PROVABLE_COMMON_CAUSAL_ROOT",
      "NEVER_INFER_AN_UNPROVEN_ROOT_CAUSE",
      "PRESERVE_STRONGER_ORACLE_AND_PROVE_PROOF_DEFECT_BEFORE_EDITING_PROOF_OWNER",
      "REPAIR_HIGHEST_CANONICAL_CAUSAL_ROOT_COMPLETELY_INCLUDING_DELETE_REFOUND_RESTRUCTURE_WHEN_REQUIRED",
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
