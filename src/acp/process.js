import * as acp from "@agentclientprotocol/sdk";
import { spawn } from "child_process";
import { Readable, Writable } from "stream";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { ANSI } from "../ui/ansi.js";

/**
 * Spawns the Coma process in ACP mode with hardened error & stderr logging.
 */
export function spawnComaProcess(binPath, context = {}) {
    console.log(`Spawning coma in ACP mode (${binPath})...`);

    let spawnCwd = process.cwd();
    if (binPath && (binPath.includes("/") || binPath.includes("\\"))) {
        const candidateRoot = path.resolve(path.dirname(binPath), "../..");
        if (fs.existsSync(candidateRoot)) {
            spawnCwd = candidateRoot;
        }
    } else {
        const scriptDir = typeof import.meta.dirname === "string"
            ? import.meta.dirname
            : path.dirname(fileURLToPath(import.meta.url));
        const repoRoot = path.resolve(scriptDir, "../..");
        const candidateComa = path.resolve(repoRoot, "../coma");
        if (fs.existsSync(candidateComa)) {
            spawnCwd = candidateComa;
        }
    }

    const child = spawn(binPath, ["--acp"], { cwd: spawnCwd });

    child.on("error", (err) => {
        if (err.code === "ENOENT") {
            console.error(`\n${ANSI.boldRed}Error: Failed to spawn coma executable at "${binPath}".${ANSI.reset}`);
            console.error(`${ANSI.yellow}Ensure coma is built or override the binary path with --bin <path> or the COMA_BIN environment variable.${ANSI.reset}\n`);
        } else {
            console.error(`\n${ANSI.boldRed}Error spawning coma process (${binPath}): ${err.message}${ANSI.reset}\n`);
        }
    });

    child.on("exit", (code, signal) => {
        if (code !== null && code !== 0) {
            console.error(`\n${ANSI.dim}[coma process exited with code ${code}${signal ? ` (signal: ${signal})` : ""}]${ANSI.reset}`);
        }
    });

    let stderrBuffer = "";
    child.stderr.on("data", (data) => {
        stderrBuffer += data.toString();
        const lines = stderrBuffer.split("\n");
        stderrBuffer = lines.pop() ?? "";
        for (const rawLine of lines) {
            const text = rawLine.trim();
            if (text && !text.includes("starting standard input/output loop")) {
                if (context.spinner && typeof context.spinner.stop === "function") {
                    context.spinner.stop();
                }
                process.stdout.write(`\n${ANSI.yellow}[stderr] ${text}${ANSI.reset}\n`);
                if (context.renderer && typeof context.renderer.restoreStyle === "function") {
                    context.renderer.restoreStyle();
                }
            }
        }
    });

    return child;
}

/**
 * Creates ndJson web stream from child process stdio for ACP SDK.
 */
export function setupNdJsonStream(child) {
    return acp.ndJsonStream(
        Writable.toWeb(child.stdin),
        Readable.toWeb(child.stdout)
    );
}
