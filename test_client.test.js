import test from "node:test";
import assert from "node:assert";
import fs from "fs";
import path from "path";
import os from "os";

import {
    parseCliArgs,
    formatToolInput,
    formatToolOutput,
    formatToolContent,
    expandFileMentions,
    exportSessionHistory,
    handleSessionUpdate,
    handleRequestPermission,
    handleSlashCommand,
    listToolCalls,
    ActivitySpinner
} from "./test_client.js";

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

test("formatToolInput - formats different types of inputs", () => {
    assert.strictEqual(formatToolInput(null), "");
    assert.strictEqual(formatToolInput(undefined), "");
    assert.strictEqual(formatToolInput("echo hello"), "echo hello");
    assert.strictEqual(formatToolInput({ command: "git status" }), "$ git status");
    assert.strictEqual(formatToolInput({ path: "/tmp/foo.txt" }), "path: /tmp/foo.txt");
    assert.strictEqual(formatToolInput({ a: 1, b: "test" }), '{"a":1,"b":"test"}');
});

test("formatToolOutput - formats and truncates output properly", () => {
    assert.strictEqual(formatToolOutput(null), "");
    assert.strictEqual(formatToolOutput(undefined), "");

    const shortOutput = "line 1\nline 2\nline 3";
    const formattedShort = formatToolOutput(shortOutput, false);
    assert.ok(formattedShort.includes("    line 1"));
    assert.ok(formattedShort.includes("    line 3"));
    assert.ok(!formattedShort.includes("truncated"));

    const longOutput = Array.from({ length: 25 }, (_, i) => `Line ${i + 1}`).join("\n");
    const truncated = formatToolOutput(longOutput, false);
    assert.ok(truncated.includes("Line 10"));
    assert.ok(!truncated.includes("Line 11"));
    assert.ok(truncated.includes("15 lines truncated"));

    const full = formatToolOutput(longOutput, true);
    assert.ok(full.includes("Line 25"));
    assert.ok(!full.includes("truncated"));
});

test("formatToolContent - extracts text and handles blocks", () => {
    const contentBlocks = [
        { type: "content", content: { type: "text", text: "Tool output text" } },
        { type: "diff", path: "src/main.rs" }
    ];
    const formatted = formatToolContent(contentBlocks, false);
    assert.ok(formatted.includes("Tool output text"));
    assert.ok(formatted.includes("[Diff for src/main.rs]"));
});

test("expandFileMentions - attaches existing files and ignores nonexistent", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "coma-test-mentions-"));
    const testFile = path.join(tempDir, "sample.txt");
    fs.writeFileSync(testFile, "Hello from sample file!");

    try {
        const promptWithFile = "Please explain @sample.txt and @nonexistent.txt";
        const result = expandFileMentions(promptWithFile, tempDir);

        assert.strictEqual(result.filesAttached.length, 1);
        assert.strictEqual(result.filesAttached[0].relativePath, "sample.txt");
        assert.strictEqual(result.filesAttached[0].content, "Hello from sample file!");

        // Content blocks should contain the user prompt + the file content block
        assert.strictEqual(result.blocks.length, 2);
        assert.strictEqual(result.blocks[0].type, "text");
        assert.strictEqual(result.blocks[0].text, promptWithFile);
        assert.strictEqual(result.blocks[1].type, "text");
        assert.ok(result.blocks[1].text.includes("Hello from sample file!"));
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test("handleSessionUpdate - thought and message chunk handling with flush", () => {
    let flushed = false;
    let written = "";

    const mockRenderer = {
        flush: () => { flushed = true; },
        reset: () => {},
        setUpdateType: () => {},
        write: (text) => { written += text; }
    };

    const context = {
        toolCalls: new Map(),
        lastUpdateType: null,
        renderer: mockRenderer,
        showThoughts: true,
        verbose: false,
        history: [],
        currentTurn: { thoughts: "", agentResponse: "", toolCalls: [] }
    };

    // 1. Thought chunk
    handleSessionUpdate({
        update: {
            sessionUpdate: "agent_thought_chunk",
            content: { type: "text", text: "Analyzing the problem..." }
        }
    }, context);

    assert.strictEqual(context.lastUpdateType, "agent_thought_chunk");
    assert.strictEqual(context.currentTurn.thoughts, "Analyzing the problem...");
    assert.strictEqual(written, "Analyzing the problem...");

    // 2. Transition to agent message chunk should flush previous renderer state
    handleSessionUpdate({
        update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Here is the answer." }
        }
    }, context);

    assert.strictEqual(flushed, true);
    assert.strictEqual(context.lastUpdateType, "agent_message_chunk");
    assert.strictEqual(context.currentTurn.agentResponse, "Here is the answer.");

    // 3. Non-text content block
    handleSessionUpdate({
        update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "image", mimeType: "image/png" }
        }
    }, context);
    // Should not crash and should update turn
});

test("handleSessionUpdate - tool call tracking and completion", () => {
    const mockRenderer = {
        flush: () => {},
        reset: () => {},
        setUpdateType: () => {},
        write: () => {}
    };

    const context = {
        toolCalls: new Map(),
        lastUpdateType: null,
        renderer: mockRenderer,
        showThoughts: true,
        verbose: false,
        history: [],
        currentTurn: { thoughts: "", agentResponse: "", toolCalls: [] }
    };

    // Tool call start
    handleSessionUpdate({
        update: {
            sessionUpdate: "tool_call",
            toolCallId: "call_123",
            title: "bash",
            status: "in_progress",
            rawInput: { command: "ls -la" }
        }
    }, context);

    assert.strictEqual(context.toolCalls.size, 1);
    const tool = context.toolCalls.get("call_123");
    assert.ok(tool);
    assert.strictEqual(tool.title, "bash");
    assert.strictEqual(tool.status, "in_progress");
    assert.deepStrictEqual(tool.rawInput, { command: "ls -la" });

    // Tool call update / completed
    handleSessionUpdate({
        update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "call_123",
            status: "completed",
            rawOutput: "file1.txt\nfile2.txt"
        }
    }, context);

    assert.strictEqual(tool.status, "completed");
    assert.strictEqual(tool.rawOutput, "file1.txt\nfile2.txt");
});

test("handleSessionUpdate - plan, usage, and mode updates", () => {
    const mockRenderer = {
        flush: () => {},
        reset: () => {},
        setUpdateType: () => {},
        write: () => {}
    };

    const context = {
        toolCalls: new Map(),
        lastUpdateType: null,
        renderer: mockRenderer,
        showThoughts: true,
        verbose: false
    };

    // Plan update
    handleSessionUpdate({
        update: {
            sessionUpdate: "plan",
            entries: [
                { content: "Step 1", status: "completed" },
                { content: "Step 2", status: "in_progress" }
            ]
        }
    }, context);
    assert.strictEqual(context.lastUpdateType, "plan");

    // Usage update
    handleSessionUpdate({
        update: {
            sessionUpdate: "usage_update",
            used: 1200,
            size: 8000,
            cost: 0.005
        }
    }, context);
    assert.strictEqual(context.lastUpdateType, "usage_update");

    // Mode update
    handleSessionUpdate({
        update: {
            sessionUpdate: "current_mode_update",
            currentModeId: "architect"
        }
    }, context);
    assert.strictEqual(context.lastUpdateType, "current_mode_update");
});

test("handleRequestPermission - interactive permission choices", async () => {
    const permissionCtx = {
        params: {
            toolCall: { title: "execute_code", rawInput: "echo 1" },
            options: [
                { optionId: "opt_allow_once", name: "Allow Once", kind: "allow_once" },
                { optionId: "opt_allow_always", name: "Allow Always", kind: "allow_always" },
                { optionId: "opt_reject", name: "Reject", kind: "reject_once" }
            ]
        }
    };

    // 1. Enter (empty) selects default allow option
    const contextEnter = {
        rl: { question: async () => "" }
    };
    const resDefault = await handleRequestPermission(permissionCtx, contextEnter);
    assert.deepStrictEqual(resDefault, {
        outcome: { outcome: "selected", optionId: "opt_allow_once" }
    });

    // 2. Select option 2
    const contextOpt2 = {
        rl: { question: async () => "2" }
    };
    const res2 = await handleRequestPermission(permissionCtx, contextOpt2);
    assert.deepStrictEqual(res2, {
        outcome: { outcome: "selected", optionId: "opt_allow_always" }
    });

    // 3. User rejects with 'n'
    const contextReject = {
        rl: { question: async () => "n" }
    };
    const resReject = await handleRequestPermission(permissionCtx, contextReject);
    assert.deepStrictEqual(resReject, {
        outcome: { outcome: "cancelled" }
    });
});

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

test("exportSessionHistory - writes complete markdown document", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "coma-test-export-"));
    const exportFile = path.join(tempDir, "session.md");

    try {
        const history = [
            {
                userPrompt: "Build the app",
                filesAttached: ["package.json"],
                thoughts: "Need to run npm build",
                toolCalls: [
                    { title: "bash", status: "completed", rawInput: { command: "npm run build" }, rawOutput: "Success" }
                ],
                agentResponse: "Build completed successfully.",
                stopReason: "endTurn"
            }
        ];

        exportSessionHistory(history, exportFile, {
            sessionId: "test-session-123",
            cwd: "/home/user/project"
        });

        assert.ok(fs.existsSync(exportFile));
        const content = fs.readFileSync(exportFile, "utf8");
        assert.ok(content.includes("test-session-123"));
        assert.ok(content.includes("/home/user/project"));
        assert.ok(content.includes("Build the app"));
        assert.ok(content.includes("package.json"));
        assert.ok(content.includes("Need to run npm build"));
        assert.ok(content.includes("npm run build"));
        assert.ok(content.includes("Build completed successfully."));
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test("ActivitySpinner - start, update, stop without error", () => {
    const spinner = new ActivitySpinner();
    spinner.start("Testing...");
    assert.strictEqual(spinner.isActive, true);
    spinner.update("Updated test...");
    spinner.stop();
    assert.strictEqual(spinner.isActive, false);
});
