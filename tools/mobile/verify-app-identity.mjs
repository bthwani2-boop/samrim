#!/usr/bin/env node
// Source admission only. Expo's evaluated config, the native archive/build tools,
// and signed binaries own their distinct runtime and release evidence.
import assert from "node:assert/strict";
import { lstatSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse } from "@babel/parser";
import { readVerifiedFile } from "../dev/source-snapshot.mjs";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const registered = {
	customer: [
		"customer",
		"com.bthwani.customer",
		"customer",
		"9b97c906-0dfc-4cf7-8d2b-079593523dc7",
	],
	merchant: [
		"merchant",
		"com.bthwani.merchant",
		"merchant",
		"c56092bf-d41b-4944-a28c-de227b3d8e8a",
	],
	captain: [
		"app-captain",
		"com.bthwani.captain",
		"captain",
		"7efa39e1-895f-44d7-a597-d613c79297b6",
	],
};
const names = Object.keys(registered);
const archiveExcludes = [
	"**/credentials.json",
	"**/google-services.json",
	"**/GoogleService-Info.plist",
	"**/*.jks",
	"**/*.keystore",
	"**/*.p12",
	"**/*.p8",
	"**/*.pem",
	"**/*.key",
	"**/.env",
	"**/.env.*",
	"**/mobile.env",
	"**/secrets.local.*",
	"**/*local*.secret.json",
];
const retiredPaths = [
	"packages/design-system/src/tokens",
	"packages/design-system/src/theme",
	"packages/design-system/src/native",
	"packages/design-system/src/semantics/studio-palette.ts",
	"packages/tamagui-config/src/preview.tsx",
	"tools/mobile/create-bthwani-metro-config.cjs",
];

export function assertRegisteredIdentity(name, manifest) {
	assert.ok(Object.hasOwn(registered, name), "Unknown mobile surface: " + name);
	const [slug, id, scheme, projectId] = registered[name];
	assert.deepEqual(
		[
			manifest.slug,
			manifest.androidPackage,
			manifest.iosBundleIdentifier,
			manifest.scheme,
			manifest.projectId,
			manifest.owner,
		],
		[slug, id, id, scheme, projectId, "bthwani1"],
		name + " registered identity changed",
	);
}

function sourceReader(base) {
	const entry = (path) =>
		lstatSync(join(base, path), { throwIfNoEntry: false });
	const file = (path, message = "Missing or non-regular source: " + path) => {
		try {
			return readVerifiedFile(join(base, path), 4 * 1024 * 1024).bytes;
		} catch (cause) {
			throw new Error(message, { cause });
		}
	};
	const decoder = new TextDecoder("utf-8", { fatal: true });
	const text = (path, message) => decoder.decode(file(path, message));
	return { entry, file, text, json: (path) => JSON.parse(text(path)) };
}

function statements(source, sourceType = "module") {
	return parse(source, { sourceType, plugins: ["typescript", "jsx"] }).program
		.body;
}
function namedImport(body, source, name) {
	for (const node of body) {
		if (
			node.type !== "ImportDeclaration" ||
			node.source.value !== source ||
			node.importKind === "type"
		)
			continue;
		for (const item of node.specifiers) {
			if (
				item.type === "ImportSpecifier" &&
				item.importKind !== "type" &&
				item.imported.name === name
			)
				return item.local.name;
		}
	}
	return undefined;
}
function defaultExport(body) {
	return body.find((node) => node.type === "ExportDefaultDeclaration")
		?.declaration;
}
function isCall(node, binding) {
	return (
		typeof binding === "string" &&
		node?.type === "CallExpression" &&
		node.callee.type === "Identifier" &&
		node.callee.name === binding
	);
}
function isString(node, value) {
	return node?.type === "StringLiteral" && node.value === value;
}
function member(node, object, property) {
	return (
		node?.type === "MemberExpression" &&
		!node.computed &&
		node.object.type === "Identifier" &&
		node.object.name === object &&
		node.property.type === "Identifier" &&
		node.property.name === property
	);
}
function propertyName(node) {
	if (node?.type !== "ObjectProperty" || node.computed) return undefined;
	return node.key.type === "Identifier" ? node.key.name : node.key.value;
}
function literal(node) {
	return node?.type === "TSAsExpression" ? node.expression : node;
}

function verifyAppConfig(source, name, slug) {
	const body = statements(source);
	const binding = namedImport(
		body,
		"../../tools/mobile/define-bthwani-expo-app.cjs",
		"defineBthwaniExpoApp",
	);
	const config = defaultExport(body);
	let call = config;
	if (name !== "captain") {
		assert.ok(
			config?.type === "ObjectExpression",
			name + " native config must export the approved Web composition",
		);
		const [spread, web] = config.properties;
		assert.ok(
			config.properties.length === 2 &&
				spread?.type === "SpreadElement" &&
				propertyName(web) === "web" &&
				web.value.type === "ObjectExpression",
			name +
				" native config must use its registered owner and explicit Web renderer",
		);
		call = spread.argument;
		const properties = web.value.properties;
		assert.equal(properties.length, 2, name + " Expo Web renderer keys drift");
		assert.ok(
			properties.some(
				(property) =>
					propertyName(property) === "bundler" &&
					isString(literal(property.value), "metro"),
			) &&
				properties.some(
					(property) =>
						propertyName(property) === "output" &&
						isString(literal(property.value), "server"),
				),
			name + " lost Expo Web SSR",
		);
	}
	assert.ok(
		isCall(call, binding) &&
			call.arguments.length === 2 &&
			isString(call.arguments[0], slug) &&
			call.arguments[1].type === "ObjectExpression",
		name + " native config must use its registered owner",
	);
}

function verifyMetro(source, name) {
	const body = statements(source, "commonjs");
	const [declaration, exported] = body;
	const variable = declaration?.declarations?.[0];
	const pattern = variable?.id;
	const property = pattern?.properties?.[0];
	const loader = variable?.init;
	const assignment = exported?.expression;
	assert.ok(
		body.length === 2 &&
			declaration.type === "VariableDeclaration" &&
			declaration.kind === "const" &&
			declaration.declarations.length === 1 &&
			pattern.type === "ObjectPattern" &&
			pattern.properties.length === 1 &&
			propertyName(property) === "getDefaultConfig" &&
			property.value.type === "Identifier" &&
			isCall(loader, "require") &&
			loader.arguments.length === 1 &&
			isString(loader.arguments[0], "expo/metro-config") &&
			assignment?.type === "AssignmentExpression" &&
			assignment.operator === "=" &&
			member(assignment.left, "module", "exports") &&
			isCall(assignment.right, property.value.name) &&
			assignment.right.arguments.length === 1 &&
			assignment.right.arguments[0].type === "Identifier" &&
			assignment.right.arguments[0].name === "__dirname",
		name + " must use native Expo Metro defaults",
	);
}

function verifyRouter(source, name) {
	const body = statements(source);
	assert.ok(
		body.some(
			(node) =>
				node.type === "ImportDeclaration" &&
				node.specifiers.length === 0 &&
				node.source.value === "expo-router/entry",
		),
		name + " must use Expo Router",
	);
}

function verifyAppearance(source, name) {
	const body = statements(source);
	const binding = namedImport(
		body,
		"@bthwani/tamagui-config/appearance",
		"createMobileAppearanceRoot",
	);
	const secureStore = body
		.find(
			(node) =>
				node.type === "ImportDeclaration" &&
				node.source.value === "expo-secure-store" &&
				node.importKind !== "type",
		)
		?.specifiers.find((item) => item.type === "ImportNamespaceSpecifier")
		?.local.name;
	const call = defaultExport(body);
	assert.ok(
		isCall(call, binding) && call.arguments.length === 4,
		name + " must use the shared appearance owner",
	);
	assert.ok(
		isString(call.arguments[0], "bthwani.stage4." + name + ".theme"),
		name + " existing appearance preference key changed",
	);
	assert.ok(
		secureStore &&
			member(call.arguments[1], secureStore, "getItemAsync") &&
			member(call.arguments[2], secureStore, "setItemAsync"),
		name + " must retain persistent native appearance storage",
	);
}

function verifyArchiveExclusions(source, name) {
	const rules = source.split(/\r?\n/);
	// EAS uses gitignore-style ordered rules. Required literal exclusions must
	// follow every re-inclusion rule; do not implement a second glob matcher or
	// confuse a leading literal space with indentation. Actual archive proof is separate.
	const lastInclude = rules.findLastIndex((rule) => rule.startsWith("!"));
	const exclusions = new Set(rules.slice(lastInclude + 1));
	for (const pattern of archiveExcludes) {
		assert.ok(
			exclusions.has(pattern),
			name + " EAS archive must exclude " + pattern + " after any re-inclusion",
		);
	}
}

function verifyPng(read, path) {
	const png = read.file(path);
	assert.ok(png.length > 24, "Empty native PNG: " + path);
	assert.equal(
		png.subarray(0, 8).toString("hex"),
		"89504e470d0a1a0a",
		"Invalid PNG: " + path,
	);
	assert.equal(png.readUInt32BE(8), 13, "Invalid PNG header length: " + path);
	assert.equal(
		png.subarray(12, 16).toString("ascii"),
		"IHDR",
		"Missing PNG header: " + path,
	);
	const width = png.readUInt32BE(16),
		height = png.readUInt32BE(20);
	assert.ok(
		width === height && width >= 512,
		"Native asset must be square and at least 512px: " + path,
	);
}

function verifyMobile(read, name) {
	const base = "apps/" + name;
	const manifest = read.json(base + "/mobile.config.json");
	assertRegisteredIdentity(name, manifest);
	const pkg = read.json(base + "/package.json");
	assert.equal(pkg.name, "@bthwani/" + name);
	assert.equal(pkg.private, true);
	assert.equal(pkg.dependencies["@bthwani/tamagui-config"], "workspace:*");
	assert.ok(
		pkg.dependencies.expo &&
			pkg.dependencies["react-native"] &&
			pkg.dependencies["expo-router"],
		name + " missing native renderer",
	);
	if (name !== "captain")
		assert.notEqual(
			pkg.type,
			"module",
			name + " Expo SSR renderer requires CommonJS package semantics",
		);
	verifyAppConfig(read.text(base + "/app.config.ts"), name, manifest.slug);
	verifyArchiveExclusions(read.text(base + "/.easignore"), name);
	verifyMetro(read.text(base + "/metro.config.cjs"), name);
	verifyRouter(read.text(base + "/index.js"), name);
	verifyAppearance(read.text(base + "/app/_layout.tsx"), name);
	const entry = name === "customer" ? "app/(tabs)/index.tsx" : "app/index.tsx";
	read.text(base + "/" + entry, "Missing app entry: " + name);
	if (name === "customer") {
		assert.ok(
			!read.entry(base + "/app/index.tsx"),
			"Duplicated Customer / route",
		);
		read.text(base + "/app/(tabs)/_layout.tsx", "Customer Tabs missing");
		assert.ok(
			!read.entry(base + "/app/foundation.tsx"),
			"Retired demo route must remain absent",
		);
	}
	for (const asset of ["icon.png", "adaptive-icon.png", "splash-icon.png"])
		verifyPng(read, base + "/assets/" + asset);
}

function verifySharedOwners(read) {
	const design = read.json("packages/design-system/package.json");
	const renderer = read.json("packages/tamagui-config/package.json");
	assert.equal(design.exports["./theme"], "./src/semantics/themes.ts");
	assert.equal(
		design.exports["./web/css-projection"],
		"./src/web/css-projection.ts",
	);
	assert.equal(renderer.exports["./appearance"], "./src/appearance.tsx");
	assert.ok(
		!Object.hasOwn(renderer.exports, "./preview"),
		"Retired presentation probe cannot be a package export",
	);
	assert.equal(renderer.dependencies["@bthwani/design-system"], "workspace:*");
	for (const path of retiredPaths)
		assert.ok(!read.entry(path), "Retired presentation path: " + path);
}

export function verifyApplicationIdentities(selected = names, base = root) {
	assert.ok(
		selected.length > 0 && selected.every((name) => names.includes(name)),
		"Unknown mobile surface",
	);
	const read = sourceReader(base);
	for (const name of selected) verifyMobile(read, name);
	verifySharedOwners(read);
	const operator = read.json("apps/control-panel/package.json");
	assert.equal(operator.name, "@bthwani/control-panel");
	assert.equal(operator.private, true);
	assert.ok(
		operator.dependencies.antd && operator.dependencies.next,
		"Operator renderer dependencies missing",
	);
	return selected.length;
}

if (
	process.argv[1] &&
	pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
	const args = process.argv.slice(2);
	assert.ok(
		args.length === 0 ||
			(args.length === 2 && args[0] === "--app" && names.includes(args[1])),
		"Usage: node tools/mobile/verify-app-identity.mjs [--app customer|merchant|captain]",
	);
	const count = verifyApplicationIdentities(args.length ? [args[1]] : names);
	console.log(
		"APPLICATION_IDENTITY_PASS apps=" + count + " native_build=NOT_RUN",
	);
}
