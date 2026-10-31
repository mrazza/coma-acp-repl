import test from "node:test";
import assert from "node:assert";
import path from "path";
import { parseCliArgs } from "../src/cli/args.js";

test("parseCliArgs - defaults", () => {
    const config = parseCliArgs([], {});
    assert.strictEqual(typeof config.bin, "string");
    assert.strictEqual(config.cwd, path.resolve(process.cwd()));
    assert.deepStrictEqual(config.additionalDirectories, []);
    assert.strictEqual(config.verbose, false);
    assert.strictEqual(config.showHelp, false);
});

test("parseCliArgs - CLI flags override defaults", () => {
    const customBin = "/usr/local/bin/coma-custom";
    const customCwd = "/tmp";
    const dir1 = "./src";
    const dir2 = "./lib";

    const config = parseCliArgs([
        "--bin", customBin,
        "--cwd", customCwd,
        "--add-dir", dir1,
        "--add-dir", dir2,
        "-v"
    ], {});

    assert.strictEqual(config.bin, customBin);
    assert.strictEqual(config.cwd, path.resolve(customCwd));
    assert.strictEqual(config.additionalDirectories.length, 2);
    assert.strictEqual(config.additionalDirectories[0], path.resolve(dir1));
    assert.strictEqual(config.additionalDirectories[1], path.resolve(dir2));
    assert.strictEqual(config.verbose, true);
});

test("parseCliArgs - env variables override defaults when flags absent", () => {
    const config = parseCliArgs([], {
        COMA_BIN: "/opt/bin/coma",
        COMA_CWD: "/var/log"
    });

    assert.strictEqual(config.bin, "/opt/bin/coma");
    assert.strictEqual(config.cwd, path.resolve("/var/log"));
});

test("parseCliArgs - help flag", () => {
    const configShort = parseCliArgs(["-h"], {});
    assert.strictEqual(configShort.showHelp, true);

    const configLong = parseCliArgs(["--help"], {});
    assert.strictEqual(configLong.showHelp, true);
});
