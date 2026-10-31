import test from "node:test";
import assert from "node:assert";

import {
    handleSessionUpdate,
    handleRequestPermission,
    handleThoughtChunk,
    handleMessageChunk,
    handleToolCallUpdate,
    handlePlanUpdate,
    handleUsageUpdate,
    handleModeUpdate
} from "../src/acp/handlers.js";

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

test("handleRequestPermission - passes abort signal and handles abort", async () => {
    const permissionCtx = {
        params: {
            toolCall: { title: "execute_code", rawInput: "echo 1" },
            options: [
                { optionId: "opt_allow_once", name: "Allow Once", kind: "allow_once" }
            ]
        }
    };

    const controller = new AbortController();
    let passedOpts = null;

    const contextAbort = {
        turnAbortController: controller,
        rl: {
            question: async (_query, opts) => {
                passedOpts = opts;
                const err = new Error("This operation was aborted");
                err.name = "AbortError";
                throw err;
            }
        }
    };

    const res = await handleRequestPermission(permissionCtx, contextAbort);
    assert.deepStrictEqual(res, { outcome: { outcome: "cancelled" } });
    assert.strictEqual(passedOpts?.signal, controller.signal);
});

test("handleSessionUpdate - spinner restarts on consecutive in_progress tool updates", () => {
    let spinnerStartedCount = 0;
    let spinnerStoppedCount = 0;
    let lastSpinnerText = "";

    const mockSpinner = {
        start: (text) => {
            spinnerStartedCount++;
            lastSpinnerText = text;
        },
        stop: () => {
            spinnerStoppedCount++;
        }
    };

    const context = {
        toolCalls: new Map(),
        lastUpdateType: null,
        spinner: mockSpinner,
        verbose: false,
        history: [],
        currentTurn: { thoughts: "", agentResponse: "", toolCalls: [] }
    };

    // 1. Initial tool_call (in_progress)
    handleSessionUpdate({
        update: {
            sessionUpdate: "tool_call",
            toolCallId: "call_abc",
            title: "read_file",
            status: "in_progress",
            rawInput: { path: "test.txt" }
        }
    }, context);

    assert.strictEqual(spinnerStoppedCount, 1);
    assert.strictEqual(spinnerStartedCount, 1);
    assert.strictEqual(lastSpinnerText, "Running read_file...");

    // 2. Consecutive tool_call_update (still in_progress)
    handleSessionUpdate({
        update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "call_abc",
            title: "read_file",
            status: "in_progress"
        }
    }, context);

    assert.strictEqual(spinnerStoppedCount, 2);
    assert.strictEqual(spinnerStartedCount, 2);
    assert.strictEqual(lastSpinnerText, "Running read_file...");
});
