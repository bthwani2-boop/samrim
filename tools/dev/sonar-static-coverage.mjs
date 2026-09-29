import { ensureKnowledgeRoot } from "./knowledge-source.mjs";

const verifierModules = [
  "./verify-donor-residue.mjs",
  "./verify-repository-structure.mjs",
  "./verify-structural-hygiene.mjs",
  "./verify-local-runtime-ownership.mjs",
  "./verify-removed-human-domain-residue.mjs",
  "./verify-doc-command-parity.mjs",
  "./verify-doc-config-parity.mjs",
  "./verify-knowledge-system.mjs",
  "./verify-knowledge-references.mjs",
  "./verify-agent-knowledge-contract.mjs",
  "./verify-workspace-dependencies.mjs",
  "./verify-nx-project-tags.mjs",
  "./verify-go-workspace-sync.mjs",
  "./verify-cache-contracts.mjs",
];

export async function executeStaticCoverageOwners() {
  ensureKnowledgeRoot({ materialize: true });
  await Promise.all(verifierModules.map((modulePath) => import(modulePath)));
}
