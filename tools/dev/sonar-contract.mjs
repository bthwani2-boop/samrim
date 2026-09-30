import fs from "node:fs";
import path from "node:path";

function parseProperties(text) {
  const properties = new Map();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    properties.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }
  return properties;
}

export function validateSonarContract({ packageJsonText, sonarPropertiesText, workflowText }) {
  const findings = [];
  const report = (code, detail) => findings.push({ code, detail });

  let packageVersion = "";
  try {
    packageVersion = String(JSON.parse(packageJsonText).version ?? "").trim();
  } catch (error) {
    report("SONAR_PACKAGE_VERSION_PARSE_FAILED", error.message);
  }
  if (!packageVersion) report("SONAR_PACKAGE_VERSION_MISSING", "root package.json must define the canonical project version");

  const properties = parseProperties(sonarPropertiesText);
  const sonarVersion = properties.get("sonar.projectVersion") ?? "";
  if (!sonarVersion) {
    report("SONAR_PROJECT_VERSION_MISSING", "previous-version analysis requires sonar.projectVersion");
  } else if (packageVersion && sonarVersion !== packageVersion) {
    report("SONAR_PROJECT_VERSION_DRIFT", `package=${packageVersion} sonar=${sonarVersion}`);
  }

  const requiredWorkflowFragments = [
    ['issue_scope="${scope}&inNewCodePeriod=true"', "SONAR_MAIN_NEW_CODE_ISSUE_SCOPE_MISSING"],
    ['fetch_issue_pages "$issue_scope" "$evidence_dir/scope-issue-pages"', "SONAR_SCOPE_ISSUE_FETCH_MISSING"],
    ['fetch_issue_pages "branch=main" "$evidence_dir/main-issue-pages"', "SONAR_MAIN_DEBT_INVENTORY_MISSING"],
    ["new_lines_to_cover,new_uncovered_lines", "SONAR_NEW_COVERAGE_EVIDENCE_MISSING"],
  ];
  for (const [fragment, code] of requiredWorkflowFragments) {
    if (!workflowText.includes(fragment)) report(code, fragment);
  }

  if (/sonar\.projectVersion[^\n]*(?:CANDIDATE_SHA|github\.sha|run_number|run_id)/i.test(workflowText)) {
    report("SONAR_BUILD_ID_USED_AS_PROJECT_VERSION", "project version must represent the repository release version, not a build or commit identifier");
  }

  return findings;
}

export function validateSonarContractAtRoot(root) {
  try {
    return validateSonarContract({
      packageJsonText: fs.readFileSync(path.join(root, "package.json"), "utf8"),
      sonarPropertiesText: fs.readFileSync(path.join(root, "sonar-project.properties"), "utf8"),
      workflowText: fs.readFileSync(path.join(root, ".github/workflows/sonar-observe.yml"), "utf8"),
    });
  } catch (error) {
    return [{ code: "SONAR_CONTRACT_READ_FAILED", detail: error.message }];
  }
}
