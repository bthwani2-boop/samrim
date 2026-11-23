import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { validate } from "./check-openapi.mjs";
import { generatedOperationSource, generatedOperationsPath } from "./generate-openapi-operations.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

for (const owner of ["identity", "dsh", "wlt"]) {
  test(`${owner} generated operation manifest matches its contract and rejects drift`, () => {
  const temp = mkdtempSync(path.join(tmpdir(), "bthwani-generated-contract-"));
  try {
    const relative = path.join("services", owner, "contracts", "openapi");
    const contractDir = path.join(temp, relative);
    cpSync(path.join(root, relative), contractDir, { recursive: true });
    const entry = YAML.parse(readFileSync(path.join(contractDir, owner + ".openapi.yaml"), "utf8"));
    const methods = new Set(["get", "post", "put", "patch", "delete", "head", "options", "trace"]);
    const operations = Object.entries(entry.paths).flatMap(([route, pointer]) => {
      const [modulePath, fragment] = pointer.$ref.split("#");
      const document = YAML.parse(readFileSync(path.resolve(contractDir, modulePath), "utf8"));
      const pathItem = fragment.slice(1).split("/").filter(Boolean).reduce(
        (value, part) => value[part.replaceAll("~1", "/").replaceAll("~0", "~")], document);
      return Object.entries(pathItem).filter(([method]) => methods.has(method)).map(
        ([method, operation]) => [operation.operationId, method.toUpperCase(), route]);
    });
    assert.ok(operations.length > 0);
    const generatedFile = generatedOperationsPath(owner, temp);
    mkdirSync(path.dirname(generatedFile), { recursive: true });
    const writeOperations = (rows) => writeFileSync(generatedFile,
      rows.map(([id, method, route]) =>
        `  ${id}: { method: "${method}", path: "${route}" },`).join("\n") + "\n", "utf8");

    writeFileSync(generatedFile, generatedOperationSource(owner, temp));
    assert.deepEqual(validate(owner, temp).errors, [], "Matching generated operations must pass");

    const mainFile = path.join(contractDir, owner + ".openapi.yaml");
    const yaml = readFileSync(mainFile, "utf8");
    const changed = yaml.replace(/^  version: [^\r\n]+/m, "  version: 99.0.0");
    assert.ok(changed !== yaml, "Fixture must change the version");
    writeFileSync(mainFile, changed);
    assert.ok(validate(owner, temp).errors.some(error => error.includes("not deterministic from current owner OpenAPI")));
    writeFileSync(mainFile, yaml);

    writeOperations(operations.slice(1));
    assert.ok(validate(owner, temp).errors.some((error) => error.includes("Generated operation mismatch")));

    const [first, ...others] = operations;
    writeOperations([[first[0], first[1] === "GET" ? "POST" : "GET", first[2]], ...others]);
    assert.ok(validate(owner, temp).errors.some((error) => error.includes("Generated operation mismatch")));

    writeOperations([...operations, ["unexpectedOperation", "GET", "/not-in-contract"]]);
    assert.ok(validate(owner, temp).errors.some((error) => error.includes("Generated operation not in OpenAPI")));

    writeOperations([...operations, operations[0]]);
    assert.ok(validate(owner, temp).errors.some((error) => error.includes("Duplicate generated operation")));
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
}
