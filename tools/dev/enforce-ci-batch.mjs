const [batchNameRaw, ...components] = process.argv.slice(2);
const batchName = String(batchNameRaw || "CI").replace(/\W+/g, "_").toUpperCase();
if (components.length === 0) {
  console.error(`${batchName}_BATCH=FAIL reason=no-components`);
  process.exit(2);
}

const failures = [];
for (const component of components) {
  const separator = component.indexOf("=");
  const name = separator >= 0 ? component.slice(0, separator) : component;
  const outcome = separator >= 0 ? component.slice(separator + 1) : "unknown";
  if (!["success", "skipped"].includes(outcome)) failures.push({ name, outcome });
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`${batchName}_COMPONENT=FAIL component=${failure.name} outcome=${failure.outcome}`);
  console.error(`${batchName}_BATCH=FAIL count=${failures.length}`);
  process.exit(1);
}

console.log(`${batchName}_BATCH=PASS components=${components.length}`);
