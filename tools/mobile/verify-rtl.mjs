#!/usr/bin/env node
// Static Arabic direction ownership; native and Web runtime acceptance remain separate.
import { lstatSync, readdirSync, realpathSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";
import { readVerifiedFile, samePath } from "../dev/source-snapshot.mjs";

const checkoutRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const apps = ["customer", "merchant", "captain"];
const documents = new Set(["apps/customer/app/+html.tsx", "apps/merchant/app/+html.tsx"]);
const extensions = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"]);
const generated = new Set(["node_modules", ".git", ".expo", ".next", ".nx"]);
const mutationNames = new Set(["forceRTL", "allowRTL", "swapLeftAndRightInRTL"]);
const readonlyNames = new Set(["isRTL", "doLeftAndRightSwapInRTL"]);
const functions = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression", "ObjectMethod", "ClassMethod", "ClassPrivateMethod"]);
const memberTypes = new Set(["MemberExpression", "OptionalMemberExpression"]);
const allowedValues = new Map([
  ["textAlign", new Set(["auto", "center", "start", "end", "justify"])],
  ["flexDirection", new Set(["row", "column", "column-reverse"])],
  ["direction", new Set(["auto", "inherit", "initial", "unset"])],
  ["writingDirection", new Set(["auto", "inherit", "initial", "unset"])],
  ["dir", new Set(["auto"])],
]);

function ast(source, filename) {
  const extension = extname(filename).toLowerCase();
  const typescript = [".ts", ".tsx", ".mts", ".cts"].includes(extension);
  const plugins = [];
  if (typescript) plugins.push("typescript");
  if (!typescript || extension === ".tsx") plugins.push("jsx");
  return parse(source, { sourceType: "unambiguous", plugins });
}

// Babel owns syntax. Walk only AST nodes; comments and metadata never become
// presentation decisions. Returning false prunes a nested lexical body.
function walk(node, visit, parent = null) {
  if (!node || typeof node.type !== "string" || node.type.startsWith("Comment")) return;
  if (visit(node, parent) === false) return;
  for (const [key, value] of Object.entries(node)) {
    if (["loc", "extra", "errors", "tokens", "comments", "leadingComments", "trailingComments", "innerComments"].includes(key)) continue;
    if (Array.isArray(value)) {
      for (const child of value) walk(child, visit, node);
    } else if (value && typeof value === "object") walk(value, visit, node);
  }
}

function unwrap(node) {
  while (node && ["TSAsExpression", "TSTypeAssertion", "TSNonNullExpression", "TSSatisfiesExpression", "ParenthesizedExpression", "JSXExpressionContainer"].includes(node.type)) node = node.expression;
  return node;
}

// An authored directional value is admitted only when all its literal
// alternatives are known and allowed. Unknown values are not guessed.
function strings(value) {
  const node = unwrap(value);
  if (!node) return null;
  if (node.type === "StringLiteral") return [node.value];
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) return [node.quasis[0].value.cooked];
  if (node.type === "ConditionalExpression") {
    const left = strings(node.consequent), right = strings(node.alternate);
    return left && right && left.length + right.length <= 32 ? [...left, ...right] : null;
  }
  if (node.type === "BinaryExpression" && node.operator === "+") {
    const left = strings(node.left), right = strings(node.right);
    return left && right && left.length * right.length <= 32 ? left.flatMap(a => right.map(b => a + b)) : null;
  }
  return null;
}

function propertyName(node, computed = false) {
  if (!computed && ["Identifier", "JSXIdentifier"].includes(node?.type)) return node.name;
  const values = strings(node);
  return values?.length === 1 ? values[0] : null;
}

function documentRoot(program) {
  const exports = program.body.filter(node => node.type === "ExportDefaultDeclaration");
  if (exports.length !== 1) return null;
  const fn = exports[0].declaration;
  if (!functions.has(fn.type)) return null;
  let body = unwrap(fn.body);
  if (body?.type === "BlockStatement") {
    const returns = [];
    walk(body, node => {
      if (functions.has(node.type)) return false;
      if (node.type === "ReturnStatement") returns.push(node);
    });
    if (returns.length !== 1 || body.body.at(-1) !== returns[0]) return null;
    body = unwrap(returns[0].argument);
  }
  return body?.type === "JSXElement" && propertyName(body.openingElement.name) === "html"
    ? body.openingElement : null;
}

function rootAttributesValid(opening) {
  const attributes = opening.attributes;
  for (const [name, value] of [["lang", "ar"], ["dir", "rtl"]]) {
    const entries = attributes.filter(attr => attr.type === "JSXAttribute" && propertyName(attr.name) === name);
    const literal = unwrap(entries[0]?.value);
    if (entries.length !== 1 || literal?.type !== "StringLiteral" || literal.value !== value) return false;
    if (attributes.slice(attributes.indexOf(entries[0]) + 1).some(attr => attr.type === "JSXSpreadAttribute")) return false;
  }
  return true;
}

function nativeAuthorityIssue(node, parent, managers) {
  if (memberTypes.has(node.type)) {
    const property = propertyName(node.property, node.computed);
    const object = unwrap(node.object);
    const directManager = object?.type === "Identifier" && managers.has(object.name);
    if (directManager) {
      const writes = (parent?.type === "AssignmentExpression" && parent.left === node) ||
        parent?.type === "UpdateExpression" ||
        (parent?.type === "UnaryExpression" && parent.operator === "delete") ||
        (["CallExpression", "OptionalCallExpression"].includes(parent?.type) && parent.callee === node);
      return !readonlyNames.has(property) || writes;
    }
    return property === "I18nManager" || mutationNames.has(property);
  }
  if (node.type !== "Identifier" || !managers.has(node.name)) return false;
  // One decision per direct member access. Bare manager references, aliases,
  // destructuring and passing the mutable manager elsewhere are not admitted.
  if (parent?.type === "ImportSpecifier") return false;
  if (memberTypes.has(parent?.type) && parent.object === node) return false;
  return true;
}

export function sourceViolations(source, filename) {
  const file = filename.replaceAll("\\", "/");
  const issues = [];
  const issue = (node, label) => issues.push(file + ":" + (node?.loc?.start?.line ?? 1) + " " + label);
  let tree;
  try { tree = ast(source, file); }
  catch (error) {
    return [file + ":" + (error.loc?.line ?? 1) + " invalid authored source syntax"];
  }
  const canonical = documents.has(file);
  const root = canonical ? documentRoot(tree.program) : null;
  if (canonical && (!root || !rootAttributesValid(root))) issue(root, "canonical Arabic document must return one explicit html lang=ar dir=rtl root");
  const managers = new Set(["I18nManager"]);
  walk(tree, node => {
    if (node.type === "ImportSpecifier" && propertyName(node.imported) === "I18nManager") managers.add(node.local.name);
  });
  function checkValue(name, value, node) {
    if (!allowedValues.has(name)) return;
    const values = strings(value);
    if (!values?.length || values.some(value => !allowedValues.get(name).has(value))) issue(node, "physical or unverified layout direction: " + name);
  }
  walk(tree, (node, parent) => {
    if (nativeAuthorityIssue(node, parent, managers)) issue(node, "runtime native RTL override or unverified native manager access");
    if ((["Identifier", "JSXIdentifier"].includes(node.type) && node.name === "LocaleProvider") ||
        (memberTypes.has(node.type) && node.computed && propertyName(node.property, true) === "LocaleProvider")) issue(node, "Expo Router manual LocaleProvider");
    if (node.type === "JSXOpeningElement") {
      if (propertyName(node.name) === "html" && node !== root) issue(node, "noncanonical HTML document root");
      for (const attr of node.attributes) {
        if (attr.type !== "JSXAttribute") continue;
        const name = propertyName(attr.name);
        if (node === root && name === "dir") continue;
        checkValue(name, attr.value, attr);
      }
    }
    if (node.type === "ObjectProperty" && parent?.type === "ObjectExpression") checkValue(propertyName(node.key, node.computed), node.value, node);
    if (node.type === "AssignmentExpression" && memberTypes.has(node.left.type)) checkValue(propertyName(node.left.property, node.left.computed), node.right, node);
  });
  return [...new Set(issues)];
}

function propertyMap(node) {
  if (node?.type !== "ObjectExpression") return null;
  const values = new Map();
  for (const property of node.properties) {
    if (property.type !== "ObjectProperty") return null;
    const name = propertyName(property.key, property.computed);
    if (!name || values.has(name)) return null;
    values.set(name, unwrap(property.value));
  }
  return values;
}

function literalBoolean(node, expected) {
  return node?.type === "BooleanLiteral" && node.value === expected;
}
function arabicArray(node) {
  return node?.type === "ArrayExpression" && node.elements.length === 1 && node.elements[0]?.type === "StringLiteral" && node.elements[0].value === "ar";
}

export function nativeConfigViolations(source) {
  const file = "tools/mobile/define-bthwani-expo-app.cjs";
  let tree;
  try { tree = ast(source, file); }
  catch { return [file + ": invalid native configuration syntax"]; }
  const declarations = [];
  walk(tree, (node, parent) => {
    if (node.type === "StringLiteral" && node.value === "expo-localization") declarations.push({ node, parent });
  });
  if (declarations.length !== 1) return [file + ": exactly one explicit native localization plugin required"];
  const { node, parent } = declarations[0];
  if (parent?.type !== "ArrayExpression" || parent.elements.length !== 2 || parent.elements[0] !== node) return [file + ": native localization plugin must use an explicit settings tuple"];
  const settings = propertyMap(parent.elements[1]);
  const locales = propertyMap(settings?.get("supportedLocales"));
  if (!settings || !locales || locales.size !== 2 ||
      !arabicArray(locales.get("ios")) || !arabicArray(locales.get("android")) ||
      !literalBoolean(settings.get("forcesRTL"), true) ||
      !literalBoolean(settings.get("allowDynamicLocaleChangesAndroid"), false) ||
      (settings.has("supportsRTL") && !literalBoolean(settings.get("supportsRTL"), true))) {
    return [file + ": native Arabic RTL settings must be explicit, unique and centrally owned"];
  }
  return [];
}

export function verifyRtl(checkout = checkoutRoot) {
  const root = resolve(checkout);
  const issues = [];
  const seenDocuments = new Set();
  let filesChecked = 0;
  const name = file => relative(root, file).replaceAll("\\", "/") || ".";
  function inspect(file, optional = false) {
    try {
      const entry = lstatSync(file, { throwIfNoEntry: false });
      if (!entry) {
        if (!optional) issues.push(name(file) + ": missing RTL source entry");
        return null;
      }
      if (entry.isSymbolicLink() || !samePath(realpathSync(file), resolve(file)) || (entry.isFile() && entry.nlink !== 1)) {
        issues.push(name(file) + ": RTL source link or hardlink is not admitted");
        return null;
      }
      return entry;
    } catch {
      issues.push(name(file) + ": RTL source entry could not be verified");
      return null;
    }
  }
  function directory(file, optional = false) {
    const entry = inspect(file, optional);
    if (!entry) return false;
    if (entry.isDirectory()) return true;
    issues.push(name(file) + ": expected real directory");
    return false;
  }
  function read(file, checker) {
    try {
      const { bytes } = readVerifiedFile(file, 4 * 1024 * 1024);
      issues.push(...checker(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    } catch {
      issues.push(name(file) + ": unreadable, changed or non-UTF-8 authored source");
    }
  }
  function scan(folder) {
    let entries;
    try { entries = readdirSync(folder, { withFileTypes: true }); }
    catch { issues.push(name(folder) + ": RTL source inventory unavailable"); return; }
    for (const entry of entries) {
      const file = join(folder, entry.name);
      const info = inspect(file);
      if (!info) continue;
      if (info.isDirectory()) {
        if (entry.name === "__tests__") continue;
        if (generated.has(entry.name.toLowerCase())) issues.push(name(file) + ": unexpected generated directory in RTL source");
        else scan(file);
      } else if (info.isFile()) {
        if (!extensions.has(extname(entry.name).toLowerCase()) || /\.(?:test|spec)\.[mc]?[jt]sx?$/i.test(entry.name)) continue;
        const path = name(file);
        if (documents.has(path)) seenDocuments.add(path);
        filesChecked++;
        read(file, source => sourceViolations(source, path));
      } else issues.push(name(file) + ": expected regular file or directory");
    }
  }
  if (!directory(root)) return { filesChecked, issues };
  if (directory(join(root, "apps"))) {
    for (const app of apps) {
      const owner = join(root, "apps", app);
      if (!directory(owner)) continue;
      for (const dir of ["app", "src"]) {
        const folder = join(owner, dir);
        if (directory(folder, dir === "src")) scan(folder);
      }
    }
  }
  for (const doc of documents) if (!seenDocuments.has(doc)) issues.push(doc + ": canonical Arabic document missing or not admitted");
  if (directory(join(root, "packages"))) {
    for (const pkg of ["design-system", "tamagui-config"]) {
      const owner = join(root, "packages", pkg);
      if (directory(owner) && directory(join(owner, "src"))) scan(join(owner, "src"));
    }
  }
  const config = join(root, "tools", "mobile", "define-bthwani-expo-app.cjs");
  if (directory(join(root, "tools")) && directory(join(root, "tools", "mobile"))) {
    const info = inspect(config);
    if (info?.isFile()) read(config, nativeConfigViolations);
    else if (info) issues.push(name(config) + ": expected native configuration file");
  }
  return { filesChecked, issues: [...new Set(issues)] };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { filesChecked, issues } = verifyRtl();
  if (issues.length) {
    console.error("EXPO_RTL_SOURCE_GUARD=FAIL");
    for (const issue of issues) console.error(" - " + issue);
    process.exitCode = 1;
  } else console.log("EXPO_RTL_SOURCE_GUARD=PASS files=" + filesChecked + " native_runtime=NOT_RUN");
}
