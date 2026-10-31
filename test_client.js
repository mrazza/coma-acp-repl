import * as acp from "@agentclientprotocol/sdk";
import { spawn } from "child_process";
import { Readable, Writable } from "stream";
import readlinePromises from "readline/promises";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { MarkdownStreamRenderer } from "./markdown_renderer.js";

/**
 * Activity spinner for asynchronous wait states (thinking, tool execution).
 */
export class ActivitySpinner {
    constructor() {
        this.frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
        this.interval = null;
        this.frameIndex = 0;
        this.currentText = "Thinking...";
        this.isActive = false;
    }

    start(text = "Thinking...") {
        this.currentText = text;
        if (this.isActive) return;
        this.isActive = true;
        this.frameIndex = 0;

        if (process.stdout.isTTY) {
            this.interval = setInterval(() => {
                const frame = this.frames[this.frameIndex++ % this.frames.length];
                process.stdout.write(`\r\x1b[90m${frame} ${this.currentText}\x1b[0m\x1b[K`);
            }, 80);
        }
    }

    update(text) {
        this.currentText = text;
    }

    stop() {
        if (!this.isActive) return;
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
        this.isActive = false;
        if (process.stdout.isTTY) {
            process.stdout.write("\r\x1b[K");
        }
    }
}

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

    let bin = binArg || env.COMA_BIN;
    if (!bin) {
        const defaultBinCandidate = path.resolve(scriptDir, "../coma/zig-out/bin/coma");
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

/**
 * Concisely formats raw tool arguments for terminal display.
 */
export function formatToolInput(rawInput) {
    if (rawInput === undefined || rawInput === null) return "";
    if (typeof rawInput === "string") return rawInput;
    try {
        if (typeof rawInput === "object") {
            if (rawInput.command && typeof rawInput.command === "string") {
                return `$ ${rawInput.command}`;
            }
            if (rawInput.path && typeof rawInput.path === "string") {
                return `path: ${rawInput.path}`;
            }
            return JSON.stringify(rawInput);
        }
        return String(rawInput);
    } catch {
        return String(rawInput);
    }
}

/**
 * Formats raw tool output for terminal display, with line truncation in non-verbose mode.
 */
export function formatToolOutput(rawOutput, verbose = false) {
    if (rawOutput === undefined || rawOutput === null) return "";
    let str = "";
    if (typeof rawOutput === "string") {
        str = rawOutput;
    } else {
        try {
            str = JSON.stringify(rawOutput, null, 2);
        } catch {
            str = String(rawOutput);
        }
    }

    const lines = str.split("\n");
    if (!verbose && lines.length > 10) {
        const preview = lines.slice(0, 10).map((l) => "    " + l).join("\n");
        const remaining = lines.length - 10;
        return `${preview}\n\x1b[90m    ... (${remaining} lines truncated. Use /verbose to see all)\x1b[0m`;
    }
    return lines.map((l) => "    " + l).join("\n");
}

/**
 * Formats tool content blocks if provided on tool updates.
 */
export function formatToolContent(contentArray, verbose = false) {
    if (!Array.isArray(contentArray) || contentArray.length === 0) return "";
    const parts = [];
    for (const item of contentArray) {
        if (item.type === "content" && item.content) {
            if (item.content.type === "text" && item.content.text) {
                parts.push(item.content.text);
            } else if (item.content.type) {
                parts.push(`[${item.content.type}]`);
            }
        } else if (item.type === "text" && item.text) {
            parts.push(item.text);
        } else if (item.type === "diff") {
            parts.push(`[Diff for ${item.path || "file"}]`);
        }
    }
    if (parts.length === 0) return "";
    return formatToolOutput(parts.join("\n"), verbose);
}

/**
 * Expands @path/to/file mentions in user prompts into ACP ContentBlocks.
 */
export function expandFileMentions(promptText, cwd = process.cwd()) {
    const mentionRegex = /(?:^|\s)@([^\s"']+)/g;
    const filesAttached = [];
    const contentBlocks = [];
    const seenPaths = new Set();

    let match;
    while ((match = mentionRegex.exec(promptText)) !== null) {
        const filePath = match[1];
        const cleanPath = filePath.replace(/[.,;:!?]+$/, "");
        const resolvedPath = path.resolve(cwd, cleanPath);

        if (!seenPaths.has(resolvedPath)) {
            seenPaths.add(resolvedPath);
            try {
                if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
                    const content = fs.readFileSync(resolvedPath, "utf8");
                    filesAttached.push({
                        mention: `@${cleanPath}`,
                        path: resolvedPath,
                        relativePath: path.relative(cwd, resolvedPath),
                        content
                    });
                }
            } catch {
                // Ignore file read errors
            }
        }
    }

    contentBlocks.push({
        type: "text",
        text: promptText
    });

    for (const file of filesAttached) {
        contentBlocks.push({
            type: "text",
            text: `--- File: ${file.relativePath} ---\n${file.content}`
        });
    }

    return {
        promptText,
        blocks: contentBlocks,
        filesAttached
    };
}

/**
 * Exports session conversation history to Markdown.
 */
export function exportSessionHistory(history, filePath, meta = {}) {
    let md = "# ACP Session History\n\n";
    md += `- **Date:** ${new Date().toISOString()}\n`;
    if (meta.sessionId) md += `- **Session ID:** \`${meta.sessionId}\`\n`;
    if (meta.cwd) md += `- **Working Directory:** \`${meta.cwd}\`\n`;
    md += "\n---\n\n";

    if (!history || history.length === 0) {
        md += "_No interactions recorded._\n";
    } else {
        history.forEach((turn, idx) => {
            md += `## Turn ${idx + 1}\n\n`;
            md += `### ❯ User\n\n${turn.userPrompt}\n\n`;
            if (turn.filesAttached && turn.filesAttached.length > 0) {
                md += `_Attached files: ${turn.filesAttached.join(", ")}_\n\n`;
            }
            if (turn.thoughts) {
                md += `### 💭 Thoughts\n\n${turn.thoughts}\n\n`;
            }
            if (turn.toolCalls && turn.toolCalls.length > 0) {
                md += `### 🔧 Tool Calls\n\n`;
                for (const tool of turn.toolCalls) {
                    md += `- **${tool.title || "Tool"}** (\`${tool.status}\`)\n`;
                    if (tool.rawInput) {
                        md += `  - **Input:** \`${formatToolInput(tool.rawInput)}\`\n`;
                    }
                    if (tool.rawOutput) {
                        const out = typeof tool.rawOutput === "object"
                            ? JSON.stringify(tool.rawOutput, null, 2)
                            : String(tool.rawOutput);
                        md += `  - **Output:**\n\`\`\`\n${out}\n\`\`\`\n`;
                    }
                }
                md += "\n";
            }
            if (turn.agentResponse) {
                md += `### 🤖 Agent\n\n${turn.agentResponse}\n\n`;
            }
            if (turn.stopReason) {
                md += `_Stop reason: ${turn.stopReason}_\n\n`;
            }
            md += "---\n\n";
        });
    }

    fs.writeFileSync(filePath, md, "utf8");
    return filePath;
}

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
        const candidateComa = path.resolve(scriptDir, "../coma");
        if (fs.existsSync(candidateComa)) {
            spawnCwd = candidateComa;
        }
    }

    const child = spawn(binPath, ["--acp"], { cwd: spawnCwd });

    child.on("error", (err) => {
        if (err.code === "ENOENT") {
            console.error(`\n\x1b[1;31mError: Failed to spawn coma executable at "${binPath}".\x1b[0m`);
            console.error(`\x1b[33mEnsure coma is built or override the binary path with --bin <path> or the COMA_BIN environment variable.\x1b[0m\n`);
        } else {
            console.error(`\n\x1b[1;31mError spawning coma process (${binPath}): ${err.message}\x1b[0m\n`);
        }
    });

    child.on("exit", (code, signal) => {
        if (code !== null && code !== 0) {
            console.error(`\n\x1b[90m[coma process exited with code ${code}${signal ? ` (signal: ${signal})` : ""}]\x1b[0m`);
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
                process.stdout.write(`\n\x1b[33m[stderr] ${text}\x1b[0m\n`);
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

/**
 * Prompts the user interactively when an ACP permission request is received.
 */
export async function handleRequestPermission(ctx, context = {}) {
    const params = ctx?.params;
    const toolTitle = params?.toolCall?.title || "Tool Call";
    const options = params?.options || [];

    if (context.spinner && typeof context.spinner.stop === "function") {
        context.spinner.stop();
    }

    process.stdout.write("\n\x1b[1;33m⚠️  [Permission Requested]\x1b[0m\n");
    process.stdout.write(`Tool: \x1b[1m${toolTitle}\x1b[0m\n`);
    if (params?.toolCall?.rawInput) {
        const inputStr = formatToolInput(params.toolCall.rawInput);
        if (inputStr) {
            process.stdout.write(`\x1b[90mArgs: ${inputStr}\x1b[0m\n`);
        }
    }

    if (!options || options.length === 0) {
        process.stdout.write("No options provided. Cancelling request.\n");
        return { outcome: { outcome: "cancelled" } };
    }

    const defaultAllowIndex = options.findIndex((opt) =>
        typeof opt.kind === "string" && opt.kind.startsWith("allow")
    );
    const defaultIndex = defaultAllowIndex >= 0 ? defaultAllowIndex : 0;

    process.stdout.write("Options:\n");
    options.forEach((opt, idx) => {
        const isDefault = idx === defaultIndex;
        process.stdout.write(`  [${idx + 1}] ${opt.name}${isDefault ? " \x1b[32m(Default: Enter)\x1b[0m" : ""}\n`);
    });

    if (!context.rl) {
        return { outcome: { outcome: "cancelled" } };
    }

    try {
        const answer = await context.rl.question(`Select option [1-${options.length}] or 'n' to cancel: `);
        const trimmed = (answer || "").trim().toLowerCase();

        if (trimmed === "n" || trimmed === "cancel" || trimmed === "reject") {
            process.stdout.write("\x1b[90mPermission cancelled by user.\x1b[0m\n");
            return { outcome: { outcome: "cancelled" } };
        }

        if (trimmed === "") {
            const selected = options[defaultIndex];
            process.stdout.write(`\x1b[32mSelected: ${selected.name}\x1b[0m\n`);
            return { outcome: { outcome: "selected", optionId: selected.optionId } };
        }

        const num = parseInt(trimmed, 10);
        if (!isNaN(num) && num >= 1 && num <= options.length) {
            const selected = options[num - 1];
            process.stdout.write(`\x1b[32mSelected: ${selected.name}\x1b[0m\n`);
            return { outcome: { outcome: "selected", optionId: selected.optionId } };
        }

        process.stdout.write("\x1b[31mInvalid option selected. Cancelling request.\x1b[0m\n");
        return { outcome: { outcome: "cancelled" } };
    } catch {
        return { outcome: { outcome: "cancelled" } };
    }
}

/**
 * Handles incoming ACP session updates and renders styled terminal output.
 */
export function handleSessionUpdate(notification, context) {
    const update = notification?.update;
    if (!update) return;

    const type = update.sessionUpdate;
    const renderer = context.renderer;

    if (context.spinner && typeof context.spinner.stop === "function") {
        context.spinner.stop();
    }

    if (type === "agent_thought_chunk") {
        if (context.showThoughts !== false) {
            if (context.lastUpdateType !== "agent_thought_chunk") {
                if (context.lastUpdateType === "agent_message_chunk") {
                    renderer.flush();
                }
                if (context.lastUpdateType) {
                    process.stdout.write("\n");
                }
                process.stdout.write("\x1b[90mThinking...\x1b[0m\n");
                renderer.reset();
            }
            renderer.setUpdateType(type);
            if (update.content?.type === "text" && typeof update.content.text === "string") {
                renderer.write(update.content.text);
            } else if (update.content?.type) {
                process.stdout.write(`\n\x1b[35m[Content: ${update.content.type}]\x1b[0m\n`);
            }
        }
        if (context.currentTurn && update.content?.text) {
            context.currentTurn.thoughts = (context.currentTurn.thoughts || "") + update.content.text;
        }
    } else if (type === "agent_message_chunk") {
        if (context.lastUpdateType !== "agent_message_chunk") {
            if (context.lastUpdateType === "agent_thought_chunk") {
                renderer.flush();
            }
            process.stdout.write("\n\x1b[1;36m❯ Agent:\x1b[0m ");
            renderer.reset();
        }
        renderer.setUpdateType(type);
        if (update.content?.type === "text" && typeof update.content.text === "string") {
            renderer.write(update.content.text);
        } else if (update.content?.type) {
            process.stdout.write(`\n\x1b[35m[Content: ${update.content.type}]\x1b[0m\n`);
        }
        if (context.currentTurn && update.content?.text) {
            context.currentTurn.agentResponse = (context.currentTurn.agentResponse || "") + update.content.text;
        }
    } else if (type === "tool_call" || type === "tool_call_update") {
        if (context.lastUpdateType === "agent_thought_chunk" || context.lastUpdateType === "agent_message_chunk") {
            renderer.flush();
        }

        let tool = context.toolCalls.get(update.toolCallId);
        const isNew = !tool;
        if (!tool) {
            tool = {
                toolCallId: update.toolCallId,
                title: update.title || "Tool",
                kind: update.kind,
                status: update.status || "pending",
                rawInput: update.rawInput,
                rawOutput: update.rawOutput,
                content: update.content,
                _loggedState: null
            };
            context.toolCalls.set(update.toolCallId, tool);
        } else {
            if (update.title) tool.title = update.title;
            if (update.kind) tool.kind = update.kind;
            if (update.status) tool.status = update.status;
            if (update.rawInput !== undefined) tool.rawInput = update.rawInput;
            if (update.rawOutput !== undefined) tool.rawOutput = update.rawOutput;
            if (update.content !== undefined) tool.content = update.content;
        }

        if (context.currentTurn) {
            const exists = context.currentTurn.toolCalls.some((t) => t.toolCallId === tool.toolCallId);
            if (!exists) {
                context.currentTurn.toolCalls.push(tool);
            }
        }

        if (tool.status === "in_progress" || tool.status === "pending") {
            if (isNew || tool._loggedState !== "started") {
                tool._loggedState = "started";
                process.stdout.write(`\n\x1b[33m🔧 [Tool Call: ${tool.title} (ID: ${tool.toolCallId}) -> ${tool.status}]\x1b[0m\n`);
                if (tool.rawInput) {
                    const formatted = formatToolInput(tool.rawInput);
                    if (formatted) {
                        process.stdout.write(`\x1b[90m  Args: ${formatted}\x1b[0m\n`);
                    }
                }
                if (context.spinner) {
                    context.spinner.start(`Running ${tool.title}...`);
                }
            }
        } else if (tool.status === "completed" || tool.status === "failed") {
            tool._loggedState = tool.status;
            const icon = tool.status === "completed" ? "\x1b[32m✓" : "\x1b[31m✗";
            process.stdout.write(`\n${icon} [Tool ${tool.status === "completed" ? "Completed" : "Failed"}: ${tool.title} (ID: ${tool.toolCallId})]\x1b[0m\n`);

            let outputText = "";
            if (tool.rawOutput !== undefined && tool.rawOutput !== null) {
                outputText = formatToolOutput(tool.rawOutput, context.verbose);
            } else if (tool.content) {
                outputText = formatToolContent(tool.content, context.verbose);
            }
            if (outputText) {
                process.stdout.write(`${outputText}\n`);
            }
        }
    } else if (type === "plan" || type === "plan_update") {
        if (context.lastUpdateType === "agent_thought_chunk" || context.lastUpdateType === "agent_message_chunk") {
            renderer.flush();
        }
        const entries = update.entries || update.plan?.entries;
        if (Array.isArray(entries) && entries.length > 0) {
            process.stdout.write("\n\x1b[1;34m📋 [Plan Update]\x1b[0m\n");
            for (const entry of entries) {
                const statusIcon = entry.status === "completed" ? "\x1b[32m✓\x1b[0m"
                    : entry.status === "in_progress" ? "\x1b[33m▶\x1b[0m"
                    : "\x1b[90m○\x1b[0m";
                const priorityBadge = entry.priority ? ` \x1b[90m(${entry.priority})\x1b[0m` : "";
                process.stdout.write(`  ${statusIcon} ${entry.content}${priorityBadge}\n`);
            }
        }
    } else if (type === "usage_update") {
        if (context.lastUpdateType === "agent_thought_chunk" || context.lastUpdateType === "agent_message_chunk") {
            renderer.flush();
        }
        const costStr = update.cost ? ` | Cost: $${typeof update.cost === "object" ? JSON.stringify(update.cost) : update.cost}` : "";
        process.stdout.write(`\n\x1b[90m📊 [Usage: ${update.used} / ${update.size} tokens${costStr}]\x1b[0m\n`);
    } else if (type === "current_mode_update") {
        if (context.lastUpdateType === "agent_thought_chunk" || context.lastUpdateType === "agent_message_chunk") {
            renderer.flush();
        }
        if (update.currentModeId) {
            process.stdout.write(`\n\x1b[34m🔀 [Mode switched to: ${update.currentModeId}]\x1b[0m\n`);
        }
    }

    context.lastUpdateType = type;
}

/**
 * Initializes the ACP session with handshake negotiation and builds the active session.
 */
export async function initializeSession(connection, config) {
    console.log("Sending initialize request...");
    const initResult = await connection.request(acp.methods.agent.initialize, {
        protocolVersion: 1,
        clientCapabilities: {},
        clientInfo: {
            name: "test-client",
            version: "1.0.0"
        }
    });
    console.log("✓ Handshake Negotiated. Protocol Version:", initResult.protocolVersion);

    console.log("Creating new session...");
    const activeSession = await connection.buildSession({
        cwd: config.cwd,
        additionalDirectories: config.additionalDirectories || [],
        mcpServers: []
    }).start();
    console.log("✓ Session Created. ID:", activeSession.sessionId);
    return activeSession;
}

/**
 * Prints the main REPL banner.
 */
export function printReplHeader() {
    console.log("\n\x1b[1;36m┌────────────────────────────────────────────────────────┐");
    console.log("│           COMA INTERACTIVE ACP CLIENT (REPL)           │");
    console.log("└────────────────────────────────────────────────────────┘\x1b[0m");
    console.log("\x1b[90mInstructions: Type prompt and press Enter. End line with \\ for multiline.\x1b[0m");
    console.log("\x1b[90mMention @file to attach file context. Type /help for slash commands.\x1b[0m\n");
}

/**
 * Prints help menu for REPL slash commands.
 */
export function printReplCommands() {
    console.log("\n\x1b[1;36mREPL Slash Commands:\x1b[0m");
    console.log("  \x1b[1m/help\x1b[0m           List all REPL commands and features");
    console.log("  \x1b[1m/new\x1b[0m            Start a fresh ACP session and clear history");
    console.log("  \x1b[1m/cwd [dir]\x1b[0m      View current working directory or switch and restart session");
    console.log("  \x1b[1m/verbose\x1b[0m        Toggle verbose mode (full tool inputs/outputs)");
    console.log("  \x1b[1m/thoughts\x1b[0m       Toggle showing/hiding agent thought stream");
    console.log("  \x1b[1m/tools\x1b[0m          List all tool calls executed in the current session");
    console.log("  \x1b[1m/export [path]\x1b[0m  Export conversation history to a Markdown file");
    console.log("  \x1b[1m/clear\x1b[0m          Clear the terminal screen and reprint header");
    console.log("  \x1b[1m/exit\x1b[0m, \x1b[1m/quit\x1b[0m     Exit the ACP client\n");
    console.log("\x1b[1;36mPrompt Syntax:\x1b[0m");
    console.log("  \x1b[1mMultiline\x1b[0m       End a line with `\\` to continue on the next line");
    console.log("  \x1b[1m@file\x1b[0m           Include `@path/to/file` in prompt to embed file contents");
    console.log("  \x1b[1mCtrl+C\x1b[0m          Cancels current prompt turn when active; exits when idle\n");
}

/**
 * Prints CLI usage information.
 */
export function printHelp() {
    console.log(`\n\x1b[1;36mComa ACP Interactive Client & REPL\x1b[0m\n
Usage:
  node test_client.js [options]

Options:
  --bin <path>        Path to coma binary (default: ../coma/zig-out/bin/coma or PATH)
  --cwd <dir>         Working directory for the session (default: current working directory)
  --add-dir <dir>     Additional directory scope (repeatable)
  -v, --verbose       Show full tool inputs/outputs and thoughts by default
  -h, --help          Show this help message and exit

Environment Variables:
  COMA_BIN            Path to coma executable
  COMA_CWD            Default working directory for ACP session

REPL Slash Commands:
  /help               Show available REPL slash commands
  /new                Start a fresh ACP session and reset state
  /cwd [dir]          Show or switch session working directory
  /verbose            Toggle verbose output mode
  /thoughts           Toggle agent thought stream visibility
  /tools              List all tool calls executed in this session
  /export [path]      Export conversation history to Markdown file
  /clear              Clear screen and redisplay header
  /exit, /quit        Exit the client
`);
}

/**
 * Lists all tool calls executed in the current session.
 */
export function listToolCalls(context) {
    if (!context.toolCalls || context.toolCalls.size === 0) {
        console.log("\x1b[90mNo tool calls have been executed in this session yet.\x1b[0m");
        return;
    }
    console.log(`\n\x1b[1mSession Tool Calls (${context.toolCalls.size}):\x1b[0m`);
    let idx = 1;
    for (const [id, tool] of context.toolCalls) {
        const icon = tool.status === "completed" ? "\x1b[32m✓\x1b[0m" : tool.status === "failed" ? "\x1b[31m✗\x1b[0m" : "\x1b[33m⏳\x1b[0m";
        console.log(`  ${idx++}. ${icon} \x1b[1m${tool.title || "Tool"}\x1b[0m (ID: ${id}) [Status: ${tool.status}]`);
        if (tool.rawInput) {
            console.log(`     \x1b[90mInput: ${formatToolInput(tool.rawInput)}\x1b[0m`);
        }
        if (tool.rawOutput) {
            const outStr = formatToolOutput(tool.rawOutput, false).trim();
            console.log(`     \x1b[90mOutput:\n${outStr}\x1b[0m`);
        }
    }
}

/**
 * Handles REPL slash commands.
 */
export async function handleSlashCommand(input, context) {
    const trimmed = input.trim();
    const parts = trimmed.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const arg = parts.slice(1).join(" ").trim();

    if (cmd === "exit" || cmd === "/exit" || cmd === "/quit") {
        return { handled: true, shouldExit: true };
    }

    if (cmd === "/help") {
        printReplCommands();
        return { handled: true, shouldExit: false };
    }

    if (cmd === "/clear") {
        process.stdout.write("\x1b[2J\x1b[0f");
        printReplHeader();
        return { handled: true, shouldExit: false };
    }

    if (cmd === "/verbose") {
        context.verbose = !context.verbose;
        console.log(`\x1b[36mVerbose mode: ${context.verbose ? "ENABLED (full tool inputs/outputs)" : "DISABLED (compact tool preview)"}\x1b[0m`);
        return { handled: true, shouldExit: false };
    }

    if (cmd === "/thoughts") {
        context.showThoughts = !context.showThoughts;
        console.log(`\x1b[36mAgent thoughts: ${context.showThoughts ? "SHOWN" : "HIDDEN"}\x1b[0m`);
        return { handled: true, shouldExit: false };
    }

    if (cmd === "/tools") {
        listToolCalls(context);
        return { handled: true, shouldExit: false };
    }

    if (cmd === "/new") {
        if (!context.connection) {
            console.log("\x1b[33mNo active connection to create a new session.\x1b[0m");
            return { handled: true, shouldExit: false };
        }
        console.log("Creating new ACP session...");
        try {
            const newSession = await context.connection.buildSession({
                cwd: context.cwd,
                additionalDirectories: context.additionalDirectories || [],
                mcpServers: []
            }).start();
            context.activeSession = newSession;
            context.toolCalls.clear();
            context.history = [];
            context.lastUpdateType = null;
            console.log(`\x1b[32m✓ New session created. ID: ${newSession.sessionId}\x1b[0m`);
        } catch (err) {
            console.error("\x1b[31mFailed to create new session:\x1b[0m", err.message);
        }
        return { handled: true, shouldExit: false };
    }

    if (cmd === "/cwd") {
        if (!arg) {
            console.log(`Current session directory: \x1b[1m${context.cwd}\x1b[0m`);
            if (context.additionalDirectories && context.additionalDirectories.length > 0) {
                console.log(`Additional directories:\n  ${context.additionalDirectories.join("\n  ")}`);
            }
            return { handled: true, shouldExit: false };
        }

        const targetDir = path.resolve(context.cwd, arg);
        if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
            console.log(`\x1b[31mError: Directory does not exist: ${targetDir}\x1b[0m`);
            return { handled: true, shouldExit: false };
        }

        context.cwd = targetDir;
        console.log(`\x1b[32m✓ Working directory changed to: ${context.cwd}\x1b[0m`);
        if (context.connection) {
            console.log("Starting new ACP session in new directory...");
            try {
                const newSession = await context.connection.buildSession({
                    cwd: context.cwd,
                    additionalDirectories: context.additionalDirectories || [],
                    mcpServers: []
                }).start();
                context.activeSession = newSession;
                context.toolCalls.clear();
                context.history = [];
                context.lastUpdateType = null;
                console.log(`\x1b[32m✓ New session created. ID: ${newSession.sessionId}\x1b[0m`);
            } catch (err) {
                console.error("\x1b[31mFailed to start new session:\x1b[0m", err.message);
            }
        }
        return { handled: true, shouldExit: false };
    }

    if (cmd === "/export") {
        const defaultPath = `acp-session-${context.activeSession?.sessionId || Date.now()}.md`;
        const targetPath = path.resolve(context.cwd, arg || defaultPath);
        try {
            exportSessionHistory(context.history, targetPath, {
                sessionId: context.activeSession?.sessionId,
                cwd: context.cwd
            });
            console.log(`\x1b[32m✓ Session exported to: ${targetPath}\x1b[0m`);
        } catch (err) {
            console.error(`\x1b[31mFailed to export session:\x1b[0m`, err.message);
        }
        return { handled: true, shouldExit: false };
    }

    if (cmd.startsWith("/")) {
        console.log(`\x1b[33mUnknown command: ${cmd}. Type /help for available commands.\x1b[0m`);
        return { handled: true, shouldExit: false };
    }

    return { handled: false, shouldExit: false };
}

/**
 * Reads user prompt input, supporting multiline input via trailing backslash (\).
 */
export async function readPromptInput(rl) {
    let fullInput = "";
    let promptString = "\n\x1b[1;32m❯ User:\x1b[0m ";

    while (true) {
        const line = await rl.question(promptString);
        if (line === null || line === undefined) {
            return null;
        }

        const trimmedEnd = line.trimEnd();
        if (trimmedEnd.endsWith("\\")) {
            fullInput += trimmedEnd.slice(0, -1) + "\n";
            promptString = "\x1b[90m... \x1b[0m";
            continue;
        }

        fullInput += line;
        break;
    }

    return fullInput;
}

/**
 * Runs the interactive REPL async loop.
 */
export async function runInteractiveRepl(context) {
    const rl = readlinePromises.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    context.rl = rl;
    context.running = true;

    let handlingSigint = false;
    const handleSigint = async () => {
        if (handlingSigint) return;
        handlingSigint = true;
        setTimeout(() => { handlingSigint = false; }, 300);

        if (context.isTurnRunning) {
            if (context.spinner) context.spinner.stop();
            process.stdout.write("\n\x1b[33m[Cancelling prompt turn...]\x1b[0m\n");
            context.abortTurn = true;
            if (context.cancelTurnPromiseResolve) {
                context.cancelTurnPromiseResolve();
            }
            if (context.activeSession) {
                try {
                    if (typeof context.activeSession.cancel === "function") {
                        await context.activeSession.cancel();
                    } else if (context.connection?.cancel) {
                        await context.connection.cancel({ sessionId: context.activeSession.sessionId });
                    } else if (context.connection?.notify) {
                        await context.connection.notify(acp.methods.agent.session.cancel, { sessionId: context.activeSession.sessionId });
                    }
                } catch {
                    // Ignore cancel errors
                }
            }
        } else {
            console.log("\nExiting ACP Client session...");
            context.running = false;
            rl.close();
            if (context.child) context.child.kill();
            process.exit(0);
        }
    };

    rl.on("SIGINT", handleSigint);

    while (context.running) {
        let promptInput;
        try {
            promptInput = await readPromptInput(rl);
        } catch {
            break;
        }

        if (promptInput === null) {
            console.log("\nExiting ACP Client session...");
            break;
        }

        const trimmed = promptInput.trim();
        if (trimmed.length === 0) {
            continue;
        }

        if (trimmed.startsWith("/") || trimmed.toLowerCase() === "exit") {
            const result = await handleSlashCommand(trimmed, context);
            if (result.shouldExit) {
                console.log("Exiting ACP Client session...");
                break;
            }
            if (result.handled) {
                continue;
            }
        }

        const { blocks, filesAttached } = expandFileMentions(trimmed, context.cwd);
        if (filesAttached.length > 0) {
            process.stdout.write(`\x1b[90m[Attached context from: ${filesAttached.map((f) => f.relativePath).join(", ")}]\x1b[0m\n`);
        }

        const currentTurn = {
            userPrompt: trimmed,
            filesAttached: filesAttached.map((f) => f.relativePath),
            thoughts: "",
            agentResponse: "",
            toolCalls: [],
            stopReason: null
        };
        context.currentTurn = currentTurn;
        context.history.push(currentTurn);

        context.isTurnRunning = true;
        context.abortTurn = false;
        let cancelPromiseResolve;
        const cancelPromise = new Promise((resolve) => {
            cancelPromiseResolve = resolve;
        });
        context.cancelTurnPromiseResolve = cancelPromiseResolve;

        if (context.spinner) {
            context.spinner.start("Thinking...");
        }

        try {
            const promptPromise = context.activeSession.prompt(blocks);
            while (true) {
                const activeMsg = await Promise.race([
                    context.activeSession.nextUpdate(),
                    cancelPromise.then(() => ({ kind: "cancelled" }))
                ]);

                if (activeMsg.kind === "cancelled") {
                    break;
                }

                if (activeMsg.kind === "stop") {
                    break;
                }

                handleSessionUpdate(activeMsg.notification, context);
            }

            if (context.spinner) {
                context.spinner.stop();
            }

            if (!context.abortTurn) {
                const result = await promptPromise;
                context.renderer.flush();
                context.lastUpdateType = null;
                currentTurn.stopReason = result.stopReason;
                console.log(`\n\x1b[90m[Response Completed. Stop Reason: ${result.stopReason}]\x1b[0m`);
            } else {
                context.renderer.flush();
                context.lastUpdateType = null;
                currentTurn.stopReason = "cancelled";
                console.log(`\n\x1b[33m[Turn Cancelled]\x1b[0m`);
            }
        } catch (err) {
            if (context.spinner) context.spinner.stop();
            context.renderer.flush();
            context.lastUpdateType = null;
            console.error("\nError sending prompt:", err);
        } finally {
            context.isTurnRunning = false;
            context.cancelTurnPromiseResolve = null;
            context.abortTurn = false;
        }
    }

    rl.close();
    if (context.child) {
        context.child.kill();
    }
}

/**
 * Main application entry point.
 */
export async function main() {
    const config = parseCliArgs(process.argv.slice(2), process.env);

    if (config.showHelp) {
        printHelp();
        process.exit(0);
    }

    const spinner = new ActivitySpinner();
    const renderer = new MarkdownStreamRenderer();

    const context = {
        bin: config.bin,
        cwd: config.cwd,
        additionalDirectories: config.additionalDirectories,
        verbose: config.verbose,
        showThoughts: true,
        toolCalls: new Map(),
        history: [],
        lastUpdateType: null,
        renderer,
        spinner,
        isTurnRunning: false,
        abortTurn: false,
        running: true
    };

    const child = spawnComaProcess(config.bin, context);
    context.child = child;

    const stream = setupNdJsonStream(child);

    await acp.client({ name: "test-client" })
        .onRequest(acp.methods.client.session.requestPermission, (ctx) => handleRequestPermission(ctx, context))
        .connectWith(stream, async (connection) => {
            context.connection = connection;
            const activeSession = await initializeSession(connection, config);
            context.activeSession = activeSession;
            printReplHeader();
            await runInteractiveRepl(context);
        });
}

const isDirectRun = process.argv[1] && (
    process.argv[1] === fileURLToPath(import.meta.url) ||
    path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
);

if (isDirectRun) {
    main().catch((err) => {
        console.error("Test failed with error:", err);
        process.exit(1);
    });
}
