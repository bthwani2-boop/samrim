function compareText(left, right) {
  return left.localeCompare(right);
}

function ownerEvidence(file, trackedFiles) {
  if ([".nx/ci-config.yaml", ".nx/workflows/agents.yaml"].includes(file)) {
    return "NX_DISTRIBUTION_CONFIG";
  }
  if (/^apps\/[^/]+\/(?:DESIGN|UX-CONTRACT)\.md$/.test(file)) {
    return "PROJECT_DOCUMENTATION_CONTRACT";
  }
  if (/^services\/[^/]+\/(?:.+\/)?(?:go\.mod|go\.sum)$/.test(file)) {
    return "GO_MODULE_MANIFEST";
  }
  if (/^services\/[^/]+\/(?:.+\/)?Dockerfile$/.test(file)) {
    return "CONTAINER_BUILD_ENTRY";
  }
  if (/^services\/[^/]+\/backend\/internal\/security\/[^/]+\.txt$/.test(file)) {
    return "SECURITY_DATA_SOURCE";
  }
  if (
    file === "packages/design-system/src/native/icon-types.ts" &&
    trackedFiles.has("packages/design-system/src/native/icons.tsx")
  ) {
    return "DESIGN_SYSTEM_NATIVE_ICON_CONTRACT";
  }
  return null;
}

export function applyTrackedArtifactOwnerContract(audit) {
  const preserved = audit.review.filter(
    (item) => !item.startsWith("REVIEW_REQUIRED:FILE:") && !item.startsWith("REVIEW_REQUIRED:DIRECTORY:"),
  );
  const unresolvedFiles = [];
  const trackedFiles = new Set(audit.files);

  for (const item of audit.review) {
    if (!item.startsWith("REVIEW_REQUIRED:FILE:")) continue;
    const file = item.slice("REVIEW_REQUIRED:FILE:".length);
    const evidence = ownerEvidence(file, trackedFiles);
    if (evidence) audit.fileEvidence.set(file, evidence);
    else unresolvedFiles.push(item);
  }

  const unresolvedDirectories = [];
  for (const directory of audit.directories) {
    const unresolved = audit.files.some(
      (file) => file.startsWith(directory + "/") && !audit.fileEvidence.has(file),
    );
    if (unresolved) unresolvedDirectories.push("REVIEW_REQUIRED:DIRECTORY:" + directory);
    else audit.directoryEvidence.set(directory, "DESCENDANT_EVIDENCE_COMPLETE");
  }

  audit.review = [...new Set([...preserved, ...unresolvedFiles, ...unresolvedDirectories])].sort(compareText);
  return audit;
}
