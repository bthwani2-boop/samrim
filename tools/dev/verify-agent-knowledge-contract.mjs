import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");

const cases = [
  {
    id: "control_panel_feature_ui_owner",
    question: "Where does surface-specific Control Panel capability UI live?",
    source: "governance/architecture/APP-SERVICE-COMPOSITION.md",
    mustInclude: ["SURFACE_SPECIFIC_FEATURE_UI → APP HOST"],
  },
  {
    id: "level4_does_not_expand_product_breadth",
    question: "Does LEVEL_4 authorize every future Product capability?",
    source: "tools/prompting/bthwani-orchestrator/01-SCOPE-AUTHORITY-RULES.md",
    mustInclude: ["LEVEL_4 != AUTHORIZATION_TO_BUILD_ALL_FUTURE_FEATURES"],
  },
  {
    id: "field_can_remain_business_deferred",
    question: "Must app-field receive business features before the first core journey?",
    source: "governance/product/PRD.md",
    mustInclude: [
      "A deployable host may remain technically ready (identity/session/bootstrap/build) while its business semantics are deliberately deferred",
      "do not create fake feature screens",
    ],
  },
  {
    id: "donor_path_is_not_target_authority",
    question: "May donor topology determine the target path?",
    source: "tools/prompting/bthwani-orchestrator/profiles/clean-target-reconstruction.md",
    mustInclude: ["DONOR_PATH != TARGET_PATH_AUTHORITY"],
  },
  {
    id: "wlt_owns_financial_truth",
    question: "Who owns wallet/ledger/payment/refund/settlement truth?",
    source: "governance/product/FINANCIAL-MODEL.md",
    mustInclude: [
      "WLT is the sole authoritative owner of internal financial truth",
      "DSH and deployable surfaces may express intent or consume bounded WLT-backed readback",
    ],
  },
  {
    id: "service_requires_independent_admission",
    question: "Does a folder or donor service name justify a service boundary?",
    source: "governance/architecture/REPOSITORY-TOPOLOGY.md",
    mustInclude: [
      "A service is admitted only when independent semantic responsibility plus the required lifecycle/storage/API/runtime boundary is proven",
    ],
  },
  {
    id: "no_current_generic_workforce_service",
    question: "Is there a current generic Workforce/people service boundary?",
    source: "governance/decisions/0008-single-actor-domain-owned-participation.md",
    mustInclude: [
      "CURRENT_GENERIC_HUMAN_PARTICIPANT_SERVICE_OR_MODULE=ABSENT",
      "DSH owns current client/partner/captain/field operational participant state",
    ],
  },
  {
    id: "reference_selection_is_not_adoption",
    question: "Does an OSS/reference recommendation authorize dependency adoption?",
    source: "governance/policies/standards-and-quality.md",
    mustInclude: ["REFERENCE_SELECTION != DEPENDENCY_ADOPTION_SELECTION"],
  },
  {
    id: "identity_public_auth_non_enumeration",
    question: "May public activation reveal blocked/disabled actor state?",
    source: "governance/product/CAPABILITIES.md",
    mustInclude: [
      "Public authentication/activation surfaces are non-enumerating",
      "public_auth_state_enumeration",
    ],
  },
  {
    id: "logout_local_state_converges_signed_out",
    question: "May the UI stay authenticated after local credentials are cleared because remote revoke failed?",
    source: "governance/product/CAPABILITIES.md",
    mustInclude: [
      "Once local credentials/cookies are cleared, every consuming host must converge to `signed_out` even if remote revocation fails",
      "local_logout_ui_divergence",
    ],
  },
  {
    id: "active_slice_has_real_terminal_token",
    question: "Can a bounded active slice close at Level 4 without activating the full target?",
    source: "tools/prompting/bthwani-orchestrator/04-VERIFY-REDIAGNOSE-CLOSE.md",
    mustInclude: ["BTHWANI_ACTIVE_PRODUCT_SLICE_LEVEL_4_COMPLETE"],
  },
  {
    id: "current_state_belongs_to_source",
    question: "What proves what is implemented now?",
    source: "governance/GOVERNANCE.md",
    mustInclude: ["SOURCE       = CURRENT IMPLEMENTATION STATE"],
  },
  {
    id: "surface_ui_not_service_frontend",
    question: "Does service business ownership imply services/<owner>/frontend?",
    source: "governance/architecture/REPOSITORY-TOPOLOGY.md",
    mustInclude: [
      "Surface-specific presentation belongs to app hosts",
      "it is not predeclared in the canonical service shape",
    ],
  },
  {
    id: "temporary_campaign_plan_retired",
    question: "May the retired clean-reconstruction campaign plan remain a live authority?",
    mustNotExist: "tools/prompting/bthwani-refoundation/05-CLEAN-REPOSITORY-RECONSTRUCTION-PLAN.md",
  },
  {
    id: "knowledge_queries_are_derived",
    question: "May a knowledge query tool become a parallel capability/journey registry?",
    source: "governance/policies/standards-and-quality.md",
    mustInclude: [
      "DERIVED_INDEX/QUERY != PARALLEL_AUTHORITY",
      "hand-maintained mirrors of Product/ownership truth are forbidden",
    ],
  },
  {
    id: "journey_ready_is_substrate_not_product_authorization",
    question: "What does Journey-Ready prove, and does it activate the next Product slice?",
    source: "governance/architecture/FOUNDATION-AND-JOURNEY-READY-SUBSTRATE.md",
    mustInclude: [
      "JOURNEY_READY_PASS",
      "JOURNEY_READY_PASS",
      "!= NEXT_PRODUCT_SLICE_AUTHORIZED",
    ],
  },
  {
    id: "provider_unknown_mutation_cannot_blind_failover",
    question: "May an unknown external financial mutation be retried through another provider immediately?",
    source: "governance/policies/providers-and-integrations.md",
    mustInclude: [
      "BLIND_FALLBACK_ON_UNKNOWN_MUTATION=0",
      "QUERY/RECONCILE_ORIGINAL_PROVIDER",
    ],
  },
  {
    id: "tooling_is_evidence_not_product_authority",
    question: "May a tool or manifest define Product/architecture ownership?",
    source: "governance/policies/tooling-and-assurance.md",
    mustInclude: [
      "TOOLS != PRODUCT TRUTH",
      "TOOLS != ARCHITECTURE OWNER",
      "TOOLS_ARE_EVIDENCE_PRODUCERS_ONLY=PASS",
    ],
  },
  {
    id: "docs_do_not_own_current_state",
    question: "Should durable Docs encode active branch/runtime state?",
    source: "governance/policies/documentation-and-knowledge.md",
    mustInclude: [
      "CURRENT STATE → SOURCE/RUNTIME/HISTORY",
      "CAMPAIGN_STATE_IN_DURABLE_DOCS = FORBIDDEN",
    ],
  },
  {
    id: "deployable_identity_survives_path_refactor",
    question: "Does moving an app folder authorize changing its Expo/package/hosting identity?",
    source: "governance/policies/delivery.md",
    mustInclude: [
      "REPOSITORY_PATH_CHANGE != DEPLOYABLE_IDENTITY_CHANGE",
      "DEPLOYABLE_IDENTITY_CHANGE → EXPLICIT_MIGRATION",
    ],
  },
  {
    id: "one_data_owner_one_migration_history",
    question: "May one data owner keep competing migration authorities?",
    source: "governance/policies/data-and-migrations.md",
    mustInclude: [
      "ONE_CANONICAL_MIGRATION_HISTORY",
      "one globally ordered canonical migration lane",
    ],
  },
  {
    id: "api_catalog_is_derived_not_manual_authority",
    question: "May the repository-wide API catalog be a hand-maintained business authority?",
    source: "governance/architecture/DATA-CONTRACTS-AND-INTEGRATIONS.md",
    mustInclude: [
      "REPOSITORY-WIDE API DISCOVERY INDEX → generated/derived or absent",
      "GENERATED NON-AUTHORITATIVE CATALOG",
    ],
  },
  {
    id: "design_system_grows_just_in_time",
    question: "Should BThwani prebuild a full domain component catalog before real consumers?",
    source: "governance/product/EXPERIENCE-AND-DESIGN.md",
    mustInclude: [
      "PREBUILD FULL DOMAIN COMPONENT CATALOG = FORBIDDEN",
      "DOMAIN_PRODUCT_TRANSLATION = DOMAIN/PRESENTATION OWNER",
    ],
  },
];

const failures = [];
const ids = new Set();

for (const testCase of cases) {
  if (ids.has(testCase.id)) failures.push("duplicate case id: " + testCase.id);
  ids.add(testCase.id);

  if (!testCase.question || !testCase.question.trim()) {
    failures.push(testCase.id + " missing question");
  }

  if (testCase.mustNotExist) {
    if (fs.existsSync(path.join(root, testCase.mustNotExist))) {
      failures.push(testCase.id + " forbidden live artifact exists: " + testCase.mustNotExist);
    }
    continue;
  }

  if (!testCase.source) {
    failures.push(testCase.id + " missing canonical source");
    continue;
  }

  const absolute = path.join(root, testCase.source);
  if (!fs.existsSync(absolute)) {
    failures.push(testCase.id + " missing canonical source: " + testCase.source);
    continue;
  }

  const body = fs.readFileSync(absolute, "utf8");
  for (const token of testCase.mustInclude ?? []) {
    if (!body.includes(token)) {
      failures.push(testCase.id + " missing invariant in " + testCase.source + ": " + token);
    }
  }
}

if (failures.length) {
  console.error("AGENT_KNOWLEDGE_CONTRACT=FAIL");
  for (const failure of failures) console.error("  " + failure);
  process.exit(1);
}

console.log("AGENT_KNOWLEDGE_CONTRACT=PASS");
console.log("CASES=" + cases.length);
for (const testCase of cases) {
  console.log(testCase.id + "\t" + (testCase.source ?? "FORBIDDEN_ARTIFACT_ABSENCE"));
}
