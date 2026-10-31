import test from "node:test";
import assert from "node:assert";
import fs from "fs";
import path from "path";
import os from "os";

import { handleSlashCommand, listToolCalls } from "../src/repl/commands.js";
import { ActivitySpinner } from "../src/ui/spinner.js";

test("handleSlashCommand - command execution and toggles", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "coma-test-slash-"));
    try {
        const context = {
            verbose: false,
            showThoughts: true,
            cwd: tempDir,
            additionalDirectories: [],
            toolCalls: new Map([
                ["id_1", { toolCallId: "id_1", title: "read_file", status: "completed", rawInput: { path: "a.txt" }, rawOutput: "hello" }]
            ]),
            history: [
                {
                    userPrompt: "What is this?",
                    filesAttached: [],
                    thoughts: "Checking...",
                    agentResponse: "It is a test.",
                    toolCalls: [],
                    stopReason: "endTurn"
                }
            ]
        };

        // /help
        const helpRes = await handleSlashCommand("/help", context);
        assert.strictEqual(helpRes.handled, true);
        assert.strictEqual(helpRes.shouldExit, false);

        // /verbose toggle
        await handleSlashCommand("/verbose", context);
        assert.strictEqual(context.verbose, true);
        await handleSlashCommand("/verbose", context);
        assert.strictEqual(context.verbose, false);

        // /thoughts toggle
        await handleSlashCommand("/thoughts", context);
        assert.strictEqual(context.showThoughts, false);
        await handleSlashCommand("/thoughts", context);
        assert.strictEqual(context.showThoughts, true);

        // /tools
        const toolsRes = await handleSlashCommand("/tools", context);
        assert.strictEqual(toolsRes.handled, true);

        // /export
        const exportPath = path.join(tempDir, "export-test.md");
        const exportRes = await handleSlashCommand(`/export ${exportPath}`, context);
        assert.strictEqual(exportRes.handled, true);
        assert.ok(fs.existsSync(exportPath));
        const exportedContent = fs.readFileSync(exportPath, "utf8");
        assert.ok(exportedContent.includes("# ACP Session History"));
        assert.ok(exportedContent.includes("What is this?"));
        assert.ok(exportedContent.includes("It is a test."));

        // /exit and /quit
        const exitRes = await handleSlashCommand("/exit", context);
        assert.strictEqual(exitRes.shouldExit, true);
        const quitRes = await handleSlashCommand("/quit", context);
        assert.strictEqual(quitRes.shouldExit, true);

        // unknown command
        const unknownRes = await handleSlashCommand("/unknownCmd", context);
        assert.strictEqual(unknownRes.handled, true);

        // non-slash command
        const normalRes = await handleSlashCommand("hello agent", context);
        assert.strictEqual(normalRes.handled, false);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test("listToolCalls - handles empty and populated tool call maps", () => {
    // Empty map
    assert.doesNotThrow(() => {
        listToolCalls({ toolCalls: new Map() });
    });

    // Populated map
    assert.doesNotThrow(() => {
        listToolCalls({
            toolCalls: new Map([
                ["c1", { title: "bash", status: "completed", rawInput: { command: "ls" }, rawOutput: "a\nb" }],
                ["c2", { title: "file", status: "failed" }]
            ])
        });
    });
});

test("ActivitySpinner - start, update, stop without error", () => {
    const spinner = new ActivitySpinner();
    spinner.start("Testing...");
    assert.strictEqual(spinner.isActive, true);
    spinner.update("Updated test...");
    spinner.stop();
    assert.strictEqual(spinner.isActive, false);
});

test("handleSlashCommand - /new and /cwd reset renderer", async () => {
    let resetCount = 0;
    const mockRenderer = {
        reset: () => {
            resetCount++;
        }
    };

    const mockConnection = {
        buildSession: () => ({
            start: async () => ({ sessionId: "new-sess-123" })
        })
    };

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "coma-test-reset-"));
    const subDir = path.join(tempDir, "subdir");
    fs.mkdirSync(subDir);

    try {
        const context = {
            cwd: tempDir,
            connection: mockConnection,
            renderer: mockRenderer,
            toolCalls: new Map([["id1", {}]]),
            history: [{ userPrompt: "hi" }],
            lastUpdateType: "agent_message_chunk"
        };

        // Test /new
        const newRes = await handleSlashCommand("/new", context);
        assert.strictEqual(newRes.handled, true);
        assert.strictEqual(resetCount, 1);
        assert.strictEqual(context.lastUpdateType, null);
        assert.strictEqual(context.history.length, 0);

        // Test /cwd with valid directory
        const cwdRes = await handleSlashCommand(`/cwd ${subDir}`, context);
        assert.strictEqual(cwdRes.handled, true);
        assert.strictEqual(resetCount, 2);
        assert.strictEqual(context.lastUpdateType, null);
        assert.strictEqual(context.cwd, subDir);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});
