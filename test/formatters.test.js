import test from "node:test";
import assert from "node:assert";
import fs from "fs";
import path from "path";
import os from "os";

import {
    formatToolInput,
    formatToolOutput,
    formatToolContent
} from "../src/ui/formatters.js";
import {
    expandFileMentions,
    exportSessionHistory
} from "../src/repl/context.js";

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
