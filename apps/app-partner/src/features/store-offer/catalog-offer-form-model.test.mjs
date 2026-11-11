import assert from "node:assert/strict";
import { test } from "node:test";
import { baseUnitOptions, buildAttributeInputs, emptyMediaProvenance, expectedPricingBasisFor, identifierResolutionNotice, isResolvedProductMatch } from "./catalog-offer-form-model.ts";

const attribute = (attributeId, valueKind, required = true, variantAxis = false) =>
  ({ attributeId, valueKind, required, variantAxis });

test("measurement and pricing options are derived from the existing DSH contract", () => {
  assert.equal(expectedPricingBasisFor("DISCRETE"), "PER_UNIT");
  assert.equal(expectedPricingBasisFor("MEASURED"), "PER_MEASURE");
  assert.equal(expectedPricingBasisFor("VARIABLE_MEASURE"), "");
  assert.equal(expectedPricingBasisFor(undefined), "");
  assert.deepEqual(baseUnitOptions("DISCRETE"), ["COUNT"]);
  assert.deepEqual(baseUnitOptions("MEASURED"), ["GRAM", "MILLILITER"]);
  assert.deepEqual(baseUnitOptions("VARIABLE_MEASURE"), ["GRAM", "MILLILITER"]);
  assert.deepEqual(baseUnitOptions(""), []);
});

test("required missing attributes fail closed, while optional blank attributes are omitted", () => {
  assert.equal(buildAttributeInputs([attribute("title", "TEXT")], {}), null);
  assert.equal(buildAttributeInputs([attribute("title", "TEXT")], { title: "  " }), null);
  assert.deepEqual(buildAttributeInputs([attribute("title", "TEXT", false)], {}),
    { productValues: [], variantValues: [] });
});

test("product attributes and variant-axis attributes keep their owners and trimmed values", () => {
  assert.deepEqual(
    buildAttributeInputs([attribute("title", "TEXT"), attribute("size", "ENUM", true, true)],
      { title: "  تجربة  ", size: "XL" }),
    {
      productValues: [{ attributeId: "title", valueKind: "TEXT", textValue: "تجربة" }],
      variantValues: [{ attributeId: "size", valueKind: "ENUM", enumValue: "XL" }],
    }
  );
});

test("invalid integer and nonfinite decimal drafts cannot be submitted", () => {
  const integer = attribute("count", "INTEGER");
  assert.equal(buildAttributeInputs([integer], { count: "1.5" }), null);
  assert.equal(buildAttributeInputs([integer], { count: "9007199254740992" }), null);
  assert.deepEqual(buildAttributeInputs([integer], { count: "5" })?.productValues,
    [{ attributeId: "count", valueKind: "INTEGER", integerValue: 5 }]);
  const decimal = attribute("weight", "DECIMAL");
  assert.equal(buildAttributeInputs([decimal], { weight: "Infinity" }), null);
  assert.deepEqual(buildAttributeInputs([decimal], { weight: "1.25" })?.productValues,
    [{ attributeId: "weight", valueKind: "DECIMAL", decimalValue: "1.25" }]);
});

test("measured attributes need an explicit unit and a finite value", () => {
  const measured = attribute("weight", "MEASUREMENT", true, true);
  assert.equal(buildAttributeInputs([measured], { weight: "2" }), null);
  assert.equal(buildAttributeInputs([measured], { weight: "NaN", "weight:unit": "GRAM" }), null);
  assert.deepEqual(
    buildAttributeInputs([measured], { weight: "2.5", "weight:unit": "GRAM" })?.variantValues,
    [{ attributeId: "weight", valueKind: "MEASUREMENT", decimalValue: "2.5", measurementUnit: "GRAM" }]
  );
});

test("boolean drafts accept only literal true or false and keep canonical semantics", () => {
  const flag = attribute("fragile", "BOOLEAN");
  assert.equal(buildAttributeInputs([flag], { fragile: "yes" }), null);
  assert.deepEqual(buildAttributeInputs([flag], { fragile: "false" })?.productValues,
    [{ attributeId: "fragile", valueKind: "BOOLEAN", booleanValue: false }]);
  assert.deepEqual(buildAttributeInputs([flag], { fragile: "true" })?.productValues,
    [{ attributeId: "fragile", valueKind: "BOOLEAN", booleanValue: true }]);
});

test("image rights default to explicitly unaccepted consent", () => {
  assert.deepEqual(emptyMediaProvenance(),
    { creator: "", sourceDescription: "", rightsStatement: "", rightsAttested: false });
  assert.notEqual(emptyMediaProvenance(), emptyMediaProvenance());
});

test("identifier results enable selection only for two already resolved product outcomes", () => {
  assert.equal(isResolvedProductMatch({ outcome: "SHARED_PRODUCT_MATCH" }), true);
  assert.equal(isResolvedProductMatch({ outcome: "STORE_LOCAL_PRODUCT_MATCH" }), true);
  for (const outcome of ["UNKNOWN_IDENTIFIER", "EXISTING_STORE_OFFER", "VARIABLE_MEASURE_IDENTIFIER",
    "UNAVAILABLE_IN_STORE", "MULTIPLE_MATCHES"]) {
    assert.equal(isResolvedProductMatch({ outcome }), false);
  }
  assert.match(identifierResolutionNotice({ outcome: "EXISTING_STORE_OFFER", productName: "دفتر" }), /دفتر/);
  assert.match(identifierResolutionNotice({ outcome: "UNAVAILABLE_IN_STORE" }), /متجر آخر/);
  assert.match(identifierResolutionNotice({ outcome: "VARIABLE_MEASURE_IDENTIFIER" }), /الكمية الفعلية/);
});
