import path from "path";
import fs from "fs";
import { ANSI } from "../ui/ansi.js";
import { formatToolInput, formatToolOutput } from "../ui/formatters.js";
import { printReplCommands, printReplHeader } from "../ui/banners.js";
import { exportSessionHistory } from "./context.js";

/**
 * Lists all tool calls executed in the current session.
 */
export function listToolCalls(context) {
    if (!context.toolCalls || context.toolCalls.size === 0) {
        console.log(`${ANSI.dim}No tool calls have been executed in this session yet.${ANSI.reset}`);
        return;
    }
    console.log(`\n${ANSI.bold}Session Tool Calls (${context.toolCalls.size}):${ANSI.reset}`);
    let idx = 1;
    for (const [id, tool] of context.toolCalls) {
        const icon = tool.status === "completed" ? `${ANSI.green}✓${ANSI.reset}` : tool.status === "failed" ? `${ANSI.red}✗${ANSI.reset}` : `${ANSI.yellow}⏳${ANSI.reset}`;
        console.log(`  ${idx++}. ${icon} ${ANSI.bold}${tool.title || "Tool"}${ANSI.reset} (ID: ${id}) [Status: ${tool.status}]`);
        if (tool.rawInput) {
            console.log(`     ${ANSI.dim}Input: ${formatToolInput(tool.rawInput)}${ANSI.reset}`);
        }
        if (tool.rawOutput) {
            const outStr = formatToolOutput(tool.rawOutput, false).trim();
            console.log(`     ${ANSI.dim}Output:\n${outStr}${ANSI.reset}`);
        }
    }
}

/**
 * Registry of REPL slash command handlers.
 */
export const COMMAND_HANDLERS = {
    exit: () => ({ handled: true, shouldExit: true }),
    "/exit": () => ({ handled: true, shouldExit: true }),
    "/quit": () => ({ handled: true, shouldExit: true }),

    "/help": () => {
        printReplCommands();
        return { handled: true, shouldExit: false };
    },

    "/clear": () => {
        process.stdout.write(ANSI.clearScreen);
        printReplHeader();
        return { handled: true, shouldExit: false };
    },

    "/verbose": (_arg, context) => {
        context.verbose = !context.verbose;
        console.log(`${ANSI.cyan}Verbose mode: ${context.verbose ? "ENABLED (full tool inputs/outputs)" : "DISABLED (compact tool preview)"}${ANSI.reset}`);
        return { handled: true, shouldExit: false };
    },

    "/thoughts": (_arg, context) => {
        context.showThoughts = !context.showThoughts;
        console.log(`${ANSI.cyan}Agent thoughts: ${context.showThoughts ? "SHOWN" : "HIDDEN"}${ANSI.reset}`);
        return { handled: true, shouldExit: false };
    },

    "/tools": (_arg, context) => {
        listToolCalls(context);
        return { handled: true, shouldExit: false };
    },

    "/new": async (_arg, context) => {
        if (!context.connection) {
            console.log(`${ANSI.yellow}No active connection to create a new session.${ANSI.reset}`);
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
            context.renderer?.reset();
            console.log(`${ANSI.green}✓ New session created. ID: ${newSession.sessionId}${ANSI.reset}`);
        } catch (err) {
            console.error(`${ANSI.red}Failed to create new session:${ANSI.reset}`, err.message);
        }
        return { handled: true, shouldExit: false };
    },

    "/cwd": async (arg, context) => {
        if (!arg) {
            console.log(`Current session directory: ${ANSI.bold}${context.cwd}${ANSI.reset}`);
            if (context.additionalDirectories && context.additionalDirectories.length > 0) {
                console.log(`Additional directories:\n  ${context.additionalDirectories.join("\n  ")}`);
            }
            return { handled: true, shouldExit: false };
        }

        const targetDir = path.resolve(context.cwd, arg);
        if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
            console.log(`${ANSI.red}Error: Directory does not exist: ${targetDir}${ANSI.reset}`);
            return { handled: true, shouldExit: false };
        }

        context.cwd = targetDir;
        console.log(`${ANSI.green}✓ Working directory changed to: ${context.cwd}${ANSI.reset}`);
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
                context.renderer?.reset();
                console.log(`${ANSI.green}✓ New session created. ID: ${newSession.sessionId}${ANSI.reset}`);
            } catch (err) {
                console.error(`${ANSI.red}Failed to start new session:${ANSI.reset}`, err.message);
            }
        }
        return { handled: true, shouldExit: false };
    },

    "/export": (arg, context) => {
        const defaultPath = `acp-session-${context.activeSession?.sessionId || Date.now()}.md`;
        const targetPath = path.resolve(context.cwd, arg || defaultPath);
        try {
            exportSessionHistory(context.history, targetPath, {
                sessionId: context.activeSession?.sessionId,
                cwd: context.cwd
            });
            console.log(`${ANSI.green}✓ Session exported to: ${targetPath}${ANSI.reset}`);
        } catch (err) {
            console.error(`${ANSI.red}Failed to export session:${ANSI.reset}`, err.message);
        }
        return { handled: true, shouldExit: false };
    }
};

/**
 * Handles REPL slash commands.
 */
export async function handleSlashCommand(input, context) {
    const trimmed = input.trim();
    const parts = trimmed.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const arg = parts.slice(1).join(" ").trim();

    const handler = COMMAND_HANDLERS[cmd];
    if (handler) {
        return await handler(arg, context);
    }

    if (cmd.startsWith("/")) {
        console.log(`${ANSI.yellow}Unknown command: ${cmd}. Type /help for available commands.${ANSI.reset}`);
        return { handled: true, shouldExit: false };
    }

    return { handled: false, shouldExit: false };
}
