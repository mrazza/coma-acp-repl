import * as acp from "@agentclientprotocol/sdk";
import { ANSI } from "./ui/ansi.js";
import { printReplHeader, printReplCommands, printHelp } from "./ui/banners.js";
import { ActivitySpinner } from "./ui/spinner.js";
import { formatToolInput, formatToolOutput, formatToolContent } from "./ui/formatters.js";
import { parseCliArgs } from "./cli/args.js";
import {
    HEADER_STYLES,
    HEADER_PREFIXES,
    isPlausibleLineStart,
    isHorizontalRule,
    matchBlockPrefix
} from "./markdown/patterns.js";
import { MarkdownStreamRenderer } from "./markdown/renderer.js";
import { spawnComaProcess, setupNdJsonStream } from "./acp/process.js";
import {
    initializeSession,
    handleRequestPermission,
    handleSessionUpdate,
    handleThoughtChunk,
    handleMessageChunk,
    handleToolCallUpdate,
    handlePlanUpdate,
    handleUsageUpdate,
    handleModeUpdate
} from "./acp/handlers.js";
import { expandFileMentions, exportSessionHistory } from "./repl/context.js";
import { listToolCalls, handleSlashCommand, COMMAND_HANDLERS } from "./repl/commands.js";
import { readPromptInput, runInteractiveRepl } from "./repl/loop.js";

// Re-export all public symbols
export {
    ANSI,
    printReplHeader,
    printReplCommands,
    printHelp,
    ActivitySpinner,
    formatToolInput,
    formatToolOutput,
    formatToolContent,
    parseCliArgs,
    HEADER_STYLES,
    HEADER_PREFIXES,
    isPlausibleLineStart,
    isHorizontalRule,
    matchBlockPrefix,
    MarkdownStreamRenderer,
    spawnComaProcess,
    setupNdJsonStream,
    initializeSession,
    handleRequestPermission,
    handleSessionUpdate,
    handleThoughtChunk,
    handleMessageChunk,
    handleToolCallUpdate,
    handlePlanUpdate,
    handleUsageUpdate,
    handleModeUpdate,
    expandFileMentions,
    exportSessionHistory,
    listToolCalls,
    handleSlashCommand,
    COMMAND_HANDLERS,
    readPromptInput,
    runInteractiveRepl
};

/**
 * Main application bootstrap and execution entry point.
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
