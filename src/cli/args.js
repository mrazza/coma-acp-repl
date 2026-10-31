import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

/**
 * Parses command-line arguments and environment variables.
 */
export function parseCliArgs(argv = process.argv.slice(2), env = process.env) {
    let binArg = null;
    let cwdArg = null;
    const additionalDirectories = [];
    let verbose = false;
    let showHelp = false;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--bin") {
            binArg = argv[++i];
        } else if (arg.startsWith("--bin=")) {
            binArg = arg.slice(6);
        } else if (arg === "--cwd") {
            cwdArg = argv[++i];
        } else if (arg.startsWith("--cwd=")) {
            cwdArg = arg.slice(6);
        } else if (arg === "--add-dir") {
            const dir = argv[++i];
            if (dir) additionalDirectories.push(path.resolve(dir));
        } else if (arg.startsWith("--add-dir=")) {
            additionalDirectories.push(path.resolve(arg.slice(10)));
        } else if (arg === "--verbose" || arg === "-v") {
            verbose = true;
        } else if (arg === "--help" || arg === "-h") {
            showHelp = true;
        }
    }

    const scriptDir = typeof import.meta.dirname === "string"
        ? import.meta.dirname
        : path.dirname(fileURLToPath(import.meta.url));
    const repoRoot = path.resolve(scriptDir, "../..");

    let bin = binArg || env.COMA_BIN;
    if (!bin) {
        const defaultBinCandidate = path.resolve(repoRoot, "../coma/zig-out/bin/coma");
        if (fs.existsSync(defaultBinCandidate)) {
            bin = defaultBinCandidate;
        } else {
            bin = "coma";
        }
    } else {
        if (bin.includes("/") || bin.includes("\\")) {
            bin = path.resolve(bin);
        }
    }

    const cwd = path.resolve(cwdArg || env.COMA_CWD || process.cwd());

    return {
        bin,
        cwd,
        additionalDirectories,
        verbose,
        showHelp
    };
}
