import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	assertRegisteredIdentity,
	verifyApplicationIdentities,
} from "./verify-app-identity.mjs";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const common = [
	"packages/design-system/package.json",
	"packages/tamagui-config/package.json",
	"apps/control-panel/package.json",
];
const mobile = [
	"mobile.config.json",
	"package.json",
	"app.config.ts",
	".easignore",
	"metro.config.cjs",
	"index.js",
	"app/_layout.tsx",
	"assets/icon.png",
	"assets/adaptive-icon.png",
	"assets/splash-icon.png",
	"app/(tabs)/index.tsx",
	"app/(tabs)/_layout.tsx",
];
function fixture(fn) {
	const base = mkdtempSync(join(tmpdir(), "bthwani-app-identity-"));
	try {
		for (const path of [
			...common,
			...mobile.map((path) => "apps/customer/" + path),
		]) {
			const target = join(base, path);
			mkdirSync(dirname(target), { recursive: true });
			copyFileSync(join(root, path), target);
		}
		return fn(base, (path) => join(base, "apps/customer", path));
	} finally {
		rmSync(base, { recursive: true, force: true });
	}
}
function changed(path, modify, expected) {
	fixture((base, app) => {
		const target = app(path);
		const original = readFileSync(target, "utf8");
		writeFileSync(target, modify(original));
		if (expected)
			assert.throws(
				() => verifyApplicationIdentities(["customer"], base),
				expected,
			);
		else assert.equal(verifyApplicationIdentities(["customer"], base), 1);
	});
}
function jsonChange(path, modify, expected) {
	changed(path, (text) => JSON.stringify(modify(JSON.parse(text))), expected);
}
const change = (old, next) => (text) => {
	assert.ok(text.includes(old), "Fixture input changed: " + old);
	return text.replace(old, next);
};
const ownerPath = "../../tools/mobile/define-bthwani-expo-app.cjs";
const metroError = /native Expo Metro defaults/;
const configError = /native config must/;
const appearanceError = /shared appearance owner/;

test("real registered manifests, public consumer and default source guard agree", () => {
	assert.equal(verifyApplicationIdentities(), 3);
	for (const name of ["customer", "merchant", "captain"]) {
		const manifest = JSON.parse(
			readFileSync(join(root, "apps", name, "mobile.config.json"), "utf8"),
		);
		assert.doesNotThrow(() => assertRegisteredIdentity(name, manifest));
		assert.throws(
			() => assertRegisteredIdentity(name, { ...manifest, projectId: "other" }),
			/registered identity changed/,
		);
	}
	assert.throws(
		() => assertRegisteredIdentity("other", {}),
		/Unknown mobile surface/,
	);
	assert.throws(
		() => verifyApplicationIdentities([]),
		/Unknown mobile surface/,
	);
	assert.throws(
		() => verifyApplicationIdentities(["other"]),
		/Unknown mobile surface/,
	);
});

test("native CLI admits its actual default and selected surface and rejects invalid arguments", () => {
	for (const args of [
		[],
		["--app", "customer"],
		["--app", "merchant"],
		["--app", "captain"],
	]) {
		const result = spawnSync(
			process.execPath,
			["tools/mobile/verify-app-identity.mjs", ...args],
			{ cwd: root, encoding: "utf8" },
		);
		assert.equal(result.status, 0, result.stderr);
		assert.match(
			result.stdout,
			new RegExp(
				"APPLICATION_IDENTITY_PASS apps=" +
					(args.length ? "1" : "3") +
					" native_build=NOT_RUN",
			),
		);
	}
	for (const args of [
		["--app"],
		["--wrong", "customer"],
		["--app", "unknown"],
	]) {
		const result = spawnSync(
			process.execPath,
			["tools/mobile/verify-app-identity.mjs", ...args],
			{ cwd: root, encoding: "utf8" },
		);
		assert.equal(result.status, 1);
		assert.match(
			result.stderr,
			/Usage: node tools\/mobile\/verify-app-identity/,
		);
	}
});

test("Expo entry requires a real side-effect import, not comments or data", () => {
	for (const source of [
		'// import "expo-router/entry";',
		'const entry = "expo-router/entry";',
		'import other from "expo-router/entry";',
		'import "another-entry";',
	]) {
		changed("index.js", () => source, /must use Expo Router/);
	}
	changed(
		"index.js",
		() => "/* optional initialization */\nimport 'expo-router/entry';",
	);
});

test("actual default Expo config retains the imported registered factory and Web renderer", () => {
	for (const [modify, error] of [
		[(text) => "/*\n" + text + "\n*/\nexport default {};", configError],
		[change(ownerPath, "./foreign-config"), configError],
		[
			change(
				"import { defineBthwaniExpoApp }",
				"import type { defineBthwaniExpoApp }",
			),
			configError,
		],
		[
			change(
				"import { defineBthwaniExpoApp }",
				"import { type defineBthwaniExpoApp }",
			),
			configError,
		],
		[
			change(
				"import { defineBthwaniExpoApp }",
				"import { unrelated as defineBthwaniExpoApp }",
			),
			configError,
		],
		[
			change(
				'...defineBthwaniExpoApp("customer"',
				'...defineBthwaniExpoApp("merchant"',
			),
			configError,
		],
		[
			change(
				'...defineBthwaniExpoApp("customer", { locationMode: "foreground", maps: true, web: true })',
				'...defineBthwaniExpoApp("customer")',
			),
			configError,
		],
		[
			change('{ locationMode: "foreground", maps: true, web: true }', "null"),
			configError,
		],
		[change("...defineBthwaniExpoApp", "...otherFactory"), configError],
		[change("web: { bundler:", '["web"]: { bundler:'), configError],
		[
			change(
				'web: { bundler: "metro" as const, output: "server" as const }',
				"web: null",
			),
			configError,
		],
		[
			change(
				'web: { bundler: "metro" as const, output: "server" as const },',
				"",
			),
			configError,
		],
		[
			change(
				'web: { bundler: "metro" as const, output: "server" as const }',
				'web: { bundler: "metro", output: "server", extra: true }',
			),
			/renderer keys drift/,
		],
		[change('bundler: "metro"', 'bundler: "webpack"'), /lost Expo Web SSR/],
		[change('output: "server"', 'output: "static"'), /lost Expo Web SSR/],
		[change('output: "server"', 'bundler: "server"'), /lost Expo Web SSR/],
		[change('bundler: "metro" as const', "...other"), /lost Expo Web SSR/],
	])
		changed("app.config.ts", modify, error);
	changed("app.config.ts", (text) =>
		text
			.replaceAll("defineBthwaniExpoApp", "approved")
			.replace(
				"import { approved }",
				"import { defineBthwaniExpoApp as approved }",
			),
	);
	changed(
		"app.config.ts",
		change(
			'bundler: "metro" as const, output: "server" as const',
			'"output": "server", "bundler": "metro"',
		),
	);
});

test("Metro requires the actual Expo default assignment, with a native CJS loader", () => {
	const valid =
		'const { getDefaultConfig } = require("expo/metro-config");\nmodule.exports = getDefaultConfig(__dirname);';
	const invalid = [
		"",
		"module.exports = {};",
		valid.replace(
			"module.exports = getDefaultConfig(__dirname);",
			"// module.exports = getDefaultConfig(__dirname);\nmodule.exports = {};",
		),
		valid.replace("const ", "let "),
		valid.replace("{ getDefaultConfig }", "{ getDefaultConfig, other }"),
		valid.replace("{ getDefaultConfig }", "getDefaultConfig"),
		valid.replace("{ getDefaultConfig }", "{ other: getDefaultConfig }"),
		valid.replace('require("expo/metro-config")', 'load("expo/metro-config")'),
		valid.replace('require("expo/metro-config")', 'require("other")'),
		valid.replace(
			'require("expo/metro-config")',
			'require("expo/metro-config", other)',
		),
		valid.replace("module.exports =", "module.exports +="),
		valid.replace("module.exports", 'module["exports"]'),
		valid.replace("module.exports", "other.exports"),
		valid.replace("module.exports", "module.other"),
		valid.replace("getDefaultConfig(__dirname)", "other(__dirname)"),
		valid.replace("getDefaultConfig(__dirname)", "getDefaultConfig()"),
		valid.replace("getDefaultConfig(__dirname)", 'getDefaultConfig("dir")'),
		valid.replace("__dirname", "otherDir"),
		valid.replace(
			'const { getDefaultConfig } = require("expo/metro-config");',
			'const { getDefaultConfig } = require("expo/metro-config"), other = 1;',
		),
	];
	for (const source of invalid)
		changed("metro.config.cjs", () => source, metroError);
	changed("metro.config.cjs", () =>
		valid
			.replace("{ getDefaultConfig }", "{ getDefaultConfig: defaults }")
			.replace("getDefaultConfig(__dirname)", "defaults(__dirname)"),
	);
});

test("appearance default export uses actual imported factory, persisted key and native storage", () => {
	for (const [modify, error] of [
		[(text) => "/*\n" + text + "\n*/\nexport default null;", appearanceError],
		[
			change('from "@bthwani/tamagui-config/appearance"', 'from "./other"'),
			appearanceError,
		],
		[
			change(
				"export default createMobileAppearanceRoot(",
				"export default other(",
			),
			appearanceError,
		],
		[
			change('"bthwani.stage4.customer.theme"', '"other"'),
			/preference key changed/,
		],
		[
			change(
				'import * as SecureStore from "expo-secure-store";',
				'import * as SecureStore from "./other";',
			),
			/persistent native appearance storage/,
		],
		[
			change("SecureStore.getItemAsync,", "other.getItemAsync,"),
			/persistent native appearance storage/,
		],
		[
			change("SecureStore.setItemAsync,", "SecureStore.getItemAsync,"),
			/persistent native appearance storage/,
		],
		[
			change("SecureStore.getItemAsync,", 'SecureStore["getItemAsync"],'),
			/persistent native appearance storage/,
		],
		[
			change("SecureStore.getItemAsync,", "null,"),
			/persistent native appearance storage/,
		],
		[change("SecureStore.setItemAsync,", ""), appearanceError],
	])
		changed("app/_layout.tsx", modify, error);
	changed("app/_layout.tsx", (text) =>
		text.replaceAll("SecureStore", "Storage"),
	);
});

test("EAS required literal exclusions survive ordered re-inclusion and reject wrong whitespace", () => {
	const pattern = "**/credentials.json";
	changed(
		".easignore",
		(text) => text + "\n!" + pattern + "\n",
		/EAS archive must exclude/,
	);
	changed(
		".easignore",
		change(pattern, " " + pattern),
		/EAS archive must exclude/,
	);
	changed(
		".easignore",
		change(pattern, "# " + pattern),
		/EAS archive must exclude/,
	);
	changed(".easignore", change(pattern, ""), /EAS archive must exclude/);
	changed(".easignore", (text) => "!**/README.md\n" + text);
	changed(".easignore", (text) =>
		text.replaceAll("\r\n", "\n").replaceAll("\n", "\r\n"),
	);
});

test("manifest, package, entry placement and asset header checks remain fail-closed", () => {
	jsonChange(
		"mobile.config.json",
		(manifest) => ({ ...manifest, owner: "other" }),
		/registered identity changed/,
	);
	jsonChange(
		"package.json",
		(pkg) => ({ ...pkg, name: "other" }),
		/AssertionError|Expected values/,
	);
	jsonChange(
		"package.json",
		(pkg) => ({ ...pkg, private: false }),
		/Expected values/,
	);
	jsonChange(
		"package.json",
		(pkg) => ({ ...pkg, type: "module" }),
		/CommonJS package semantics/,
	);
	jsonChange(
		"package.json",
		(pkg) => ({ ...pkg, dependencies: { ...pkg.dependencies, expo: null } }),
		/missing native renderer/,
	);
	jsonChange(
		"package.json",
		(pkg) => ({
			...pkg,
			dependencies: { ...pkg.dependencies, "react-native": null },
		}),
		/missing native renderer/,
	);
	jsonChange(
		"package.json",
		(pkg) => ({
			...pkg,
			dependencies: { ...pkg.dependencies, "expo-router": null },
		}),
		/missing native renderer/,
	);
	jsonChange(
		"package.json",
		(pkg) => ({
			...pkg,
			dependencies: { ...pkg.dependencies, "@bthwani/tamagui-config": "other" },
		}),
		/Expected values/,
	);
	for (const [path, action, error] of [
		["app/(tabs)/index.tsx", "delete", /Missing app entry/],
		["app/(tabs)/_layout.tsx", "delete", /Customer Tabs missing/],
		["app/index.tsx", "add", /Duplicated Customer/],
		["app/foundation.tsx", "add", /Retired demo route/],
		["metro.config.cjs", "directory", /non-regular source/],
		["mobile.config.json", "delete", /non-regular source/],
	])
		fixture((base, app) => {
			const target = app(path);
			if (action === "add") writeFileSync(target, "export default null;");
			else {
				rmSync(target);
				if (action === "directory") mkdirSync(target);
			}
			assert.throws(
				() => verifyApplicationIdentities(["customer"], base),
				error,
			);
		});
	for (const [mutate, error] of [
		[() => Buffer.alloc(10), /Empty native PNG/],
		[
			(png) => {
				png[0] = 0;
				return png;
			},
			/Invalid PNG:/,
		],
		[
			(png) => {
				png.writeUInt32BE(12, 8);
				return png;
			},
			/Invalid PNG header length/,
		],
		[
			(png) => {
				png.write("FAKE", 12);
				return png;
			},
			/Missing PNG header/,
		],
		[
			(png) => {
				png.writeUInt32BE(512, 16);
				png.writeUInt32BE(513, 20);
				return png;
			},
			/square and at least 512px/,
		],
		[
			(png) => {
				png.writeUInt32BE(511, 16);
				png.writeUInt32BE(511, 20);
				return png;
			},
			/square and at least 512px/,
		],
	])
		fixture((base, app) => {
			const target = app("assets/icon.png");
			writeFileSync(target, mutate(readFileSync(target)));
			assert.throws(
				() => verifyApplicationIdentities(["customer"], base),
				error,
			);
		});
});

test("shared renderer and Operator ownership checks preserve retired-path absence", () => {
	for (const [path, modify, error] of [
		[
			"packages/design-system/package.json",
			(pkg) => {
				pkg.exports["./theme"] = "other";
			},
			/Expected values/,
		],
		[
			"packages/design-system/package.json",
			(pkg) => {
				pkg.exports["./web/css-projection"] = "other";
			},
			/Expected values/,
		],
		[
			"packages/tamagui-config/package.json",
			(pkg) => {
				pkg.exports["./appearance"] = "other";
			},
			/Expected values/,
		],
		[
			"packages/tamagui-config/package.json",
			(pkg) => {
				pkg.exports["./preview"] = "other";
			},
			/Retired presentation probe/,
		],
		[
			"packages/tamagui-config/package.json",
			(pkg) => {
				pkg.dependencies["@bthwani/design-system"] = "other";
			},
			/Expected values/,
		],
		[
			"apps/control-panel/package.json",
			(pkg) => {
				pkg.name = "other";
			},
			/Expected values/,
		],
		[
			"apps/control-panel/package.json",
			(pkg) => {
				pkg.private = false;
			},
			/Expected values/,
		],
		[
			"apps/control-panel/package.json",
			(pkg) => {
				delete pkg.dependencies.antd;
			},
			/Operator renderer dependencies missing/,
		],
		[
			"apps/control-panel/package.json",
			(pkg) => {
				delete pkg.dependencies.next;
			},
			/Operator renderer dependencies missing/,
		],
	])
		fixture((base) => {
			const target = join(base, path);
			const pkg = JSON.parse(readFileSync(target, "utf8"));
			modify(pkg);
			writeFileSync(target, JSON.stringify(pkg));
			assert.throws(
				() => verifyApplicationIdentities(["customer"], base),
				error,
			);
		});
	fixture((base) => {
		mkdirSync(join(base, "packages/design-system/src/tokens"), {
			recursive: true,
		});
		assert.throws(
			() => verifyApplicationIdentities(["customer"], base),
			/Retired presentation path/,
		);
	});
});
