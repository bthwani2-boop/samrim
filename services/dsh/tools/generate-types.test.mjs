import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import YAML from "yaml";

const root = path.resolve(import.meta.dirname, "../../..");
const contract = YAML.parse(readFileSync(path.join(root, "services/dsh/contracts/openapi/dsh.openapi.yaml"), "utf8"));
const generatedGo = readFileSync(path.join(root, "services/dsh/backend/internal/contract/dsh_types_generated.go"), "utf8");
const generatedTS = readFileSync(path.join(root, "services/dsh/clients/generated/dsh-types.ts"), "utf8");

for (const schemaName of ["UploadCatalogProductMediaRequest", "UploadCatalogCategoryMediaRequest"]) {
  test(`${schemaName} Go field matches the boolean rights-attestation OpenAPI contract`, () => {
    const schema = contract.components.schemas[schemaName];
    assert.equal(schema.properties.rightsAttested.type, "boolean");
    assert.deepEqual(schema.properties.rightsAttested.enum, [true]);

    const goMatch = generatedGo.match(new RegExp(`type ${schemaName} struct \\{([\\s\\S]*?)\\n\\}`));
    const tsMatch = generatedTS.match(new RegExp(`export type ${schemaName} = \\{([\\s\\S]*?)\\n\\};`));
    assert.ok(goMatch, `missing generated Go struct ${schemaName}`);
    assert.ok(tsMatch, `missing generated TS object ${schemaName}`);
    assert.match(goMatch[1], /\bRightsAttested\s+bool\b/, "generated Go must not call a JSON boolean a string");
    assert.match(tsMatch[1], /\breadonly rightsAttested: true;/, "generated TS must preserve true-only consent");
  });
}

const numericEnums = [
  ["StudioLayoutPublication", "schemaVersion", "SchemaVersion"],
  ["StudioThemePublication", "schemaVersion", "SchemaVersion"],
  ["StudioDraftDocument", "schemaVersion", "SchemaVersion"],
  ["CreateDeliveryFeePolicyRequest", "roundingUnitMinor", "RoundingUnitMinor"],
  ["DeliveryFeePolicy", "roundingUnitMinor", "RoundingUnitMinor"],
  ["FieldAcquisitionRewardPolicy", "roundingUnitMinor", "RoundingUnitMinor"],
];

for (const [schemaName, property, field] of numericEnums) {
  test(`${schemaName}.${property} remains numeric in generated Go`, () => {
    const schema = contract.components.schemas[schemaName];
    const rule = schema.properties[property];
    assert.equal(rule.type, "integer");
    assert.ok(rule.enum?.length > 0 || rule.const !== undefined);
    const body = generatedGo.match(new RegExp(`type ${schemaName} struct \\{([\\s\\S]*?)\\n\\}`))?.[1];
    assert.ok(body, `missing Go struct ${schemaName}`);
    assert.match(body, new RegExp(`\\b${field}\\s+int\\b`));
  });
}
