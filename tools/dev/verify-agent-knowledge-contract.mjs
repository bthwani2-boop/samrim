import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const failures = [];

const cases = [
  {
    id: "surface_ui_owner",
    source: "governance/architecture/APP-SERVICE-COMPOSITION.md",
    include: ["SURFACE_SPECIFIC_FEATURE_UI → APP HOST"],
  },
  {
    id: "service_admission",
    source: "governance/architecture/REPOSITORY-TOPOLOGY.md",
    include: ["container is admitted only when the corresponding semantic responsibility"],
  },
  {
    id: "no_empty_readiness_lanes",
    source: "governance/architecture/PLATFORM-SUBSTRATE.md",
    include: ["EMPTY_LANE_AS_READINESS_EVIDENCE = FORBIDDEN"],
  },
  {
    id: "level4_not_future_breadth",
    source: "tools/prompting/bthwani-orchestrator/00-ORCHESTRATOR.md",
    include: ["`LEVEL_4` defines completion depth", "never future Product breadth"],
  },
  {
    id: "causal_not_global_stage",
    source: "tools/prompting/bthwani-orchestrator/00-ORCHESTRATOR.md",
    include: ["There is one execution cycle, not a mandatory stage pipeline"],
  },
  {
    id: "structural_substrate_conditional",
    source: "tools/prompting/bthwani-orchestrator/profiles/structural-substrate.md",
    include: ["conditional", "EMPTY FUTURE LANES = FORBIDDEN"],
  },
  {
    id: "active_slice_terminal",
    source: "tools/prompting/bthwani-orchestrator/verify/unit-and-scope-closure.md",
    include: ["BTHWANI_ACTIVE_PRODUCT_SLICE_LEVEL_4_COMPLETE"],
  },
  {
    id: "donor_not_topology",
    source: "tools/prompting/bthwani-orchestrator/profiles/clean-target-reconstruction.md",
    include: ["DONOR_PATH != TARGET_PATH_AUTHORITY", "COPIED_BECAUSE_DONOR_HAD_IT = FORBIDDEN"],
  },
  {
    id: "financial_truth",
    source: "governance/product/FINANCIAL-MODEL.md",
    include: ["WLT is the sole authoritative owner of internal financial truth"],
  },
  {
    id: "identity_public_non_enumeration",
    source: "governance/product/capabilities/access/identity-activation-sessions.md",
    include: ["public_auth_state_enumeration"],
  },
  {
    id: "managed_activation_one_time",
    source: "governance/product/capabilities/access/identity-activation-sessions.md",
    include: ["one-time activation before their first role session", "repeated_managed_activation"],
  },
  {
    id: "operator_mfa",
    source: "governance/product/capabilities/access/identity-activation-sessions.md",
    include: ["Operator normal access requires password plus a second authentication factor/challenge"],
  },
  {
    id: "provider_unknown_no_blind_failover",
    source: "governance/policies/providers-and-integrations.md",
    include: ["BLIND_FALLBACK_ON_UNKNOWN_MUTATION=0"],
  },
  {
    id: "deployable_identity_preserved",
    source: "governance/policies/delivery/change-qualification.md",
    include: ["REPOSITORY_PATH_CHANGE != DEPLOYABLE_IDENTITY_CHANGE"],
  },
  {
    id: "docs_not_current_state",
    source: "governance/GOVERNANCE.md",
    include: ["SOURCE       = CURRENT EXECUTABLE IMPLEMENTATION / CONFIGURATION / RUNTIME"],
  },
  {
    id: "governance_reconstruction_completeness",
    source: "governance/GOVERNANCE.md",
    include: ["Developer reconstruction acceptance", "UNACCOUNTED_MATERIAL_PRODUCT_RESPONSIBILITIES=0", "UNMAPPED_REQUIRED_FAILURE/RECOVERY_SEMANTICS=0"],
  },
  {
    id: "rollout_fail_closed_and_effective_readback",
    source: "governance/product/capabilities/access/platform-sovereign-control-plane.md",
    include: ["EMPTY_OR_UNKNOWN_TARGET_SELECTOR = FAIL_CLOSED", "CONTROL_PLANE_READBACK != EFFECTIVE_CONSUMER_APPLICATION", "ROLLBACK_MUST_NOT_OVERWRITE_NEWER_REVISION"],
  },
  {
    id: "anti_forgetting_candidate_proof",
    source: "tools/prompting/bthwani-orchestrator/templates/candidate-proof-matrix.md",
    include: ["Complete affected-cone accounting", "Full binding chain", "Supporting-value accounting", "UNACCOUNTED_FAILURE_UNKNOWN_RECOVERY=0"],
  },
  {
    id: "donor_semantic_zero_loss",
    source: "tools/prompting/bthwani-orchestrator/profiles/clean-target-reconstruction.md",
    include: ["Semantic-atom accounting record", "ACTIVE_SLICE_DONOR_CONE_ACCOUNTING=COMPLETE", "UNINSPECTED_DONOR_HISTORY_MATERIAL_TO_ACTIVE_SLICE=0"],
  },
  {
    id: "no_live_adr_tree",
    source: "governance/GOVERNANCE.md",
    include: ["No live ADR tree"],
  },
];

for (const test of cases) {
  const absolute = path.join(root, test.source);
  if (!fs.existsSync(absolute)) {
    failures.push(test.id + " missing source: " + test.source);
    continue;
  }
  const body = fs.readFileSync(absolute, "utf8");
  for (const token of test.include) {
    if (!body.includes(token)) failures.push(test.id + " missing invariant in " + test.source + ": " + token);
  }
}

for (const forbidden of [
  "governance/decisions",
  "docs/platform-engineering-lifecycle",
  "docs/reference/target-operations",
  "tools/prompting/bthwani-refoundation",
  "tools/prompting/bthwani-orchestrator/templates/required-truth-census.md",
  "tools/prompting/bthwani-orchestrator/templates/donor-zero-loss-accounting.md",
]) {
  if (fs.existsSync(path.join(root, forbidden))) failures.push("forbidden live artifact exists: " + forbidden);
}

if (failures.length) {
  console.error("AGENT_KNOWLEDGE_CONTRACT=FAIL");
  for (const failure of failures) console.error("  " + failure);
  process.exit(1);
}
console.log("AGENT_KNOWLEDGE_CONTRACT=PASS");
console.log("CASES=" + cases.length);
