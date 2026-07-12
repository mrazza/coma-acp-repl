import * as acp from "@agentclientprotocol/sdk";
import { spawn } from "child_process";
import { Readable, Writable } from "stream";
import readline from "readline";
import { MarkdownStreamRenderer } from "./markdown_renderer.js";


function spawnComaProcess() {
    console.log("Spawning coma in ACP mode...");
    const child = spawn("./zig-out/bin/coma", ["--acp"], { cwd: "../coma/" });
    child.stderr.on("data", (data) => {
        const text = data.toString().trim();
        if (text && !text.includes("starting standard input/output loop")) {
            console.log(`\n[stderr] ${text}`);
        }
    });
    return child;
}

function setupNdJsonStream(child) {
    return acp.ndJsonStream(
        Writable.toWeb(child.stdin),
        Readable.toWeb(child.stdout)
    );
}

function handleRequestPermission(ctx) {
    console.log("\n→ Permission requested:", ctx.params);
    return { outcome: { outcome: "cancelled" } };
}

function handleSessionUpdate(ctx, context) {
    const params = ctx.params;
    const update = params.update;
    if (!update) return;

    const type = update.sessionUpdate;
    const renderer = context.renderer;

    if (type === "agent_thought_chunk") {
        if (context.lastUpdateType !== "agent_thought_chunk") {
            if (context.lastUpdateType) {
                process.stdout.write("\n");
            }
            process.stdout.write("\x1b[90mThinking...\x1b[0m\n");
            renderer.reset();
        }
        renderer.setUpdateType(type);
        renderer.write(update.content.text);
    } else if (type === "agent_message_chunk") {
        if (context.lastUpdateType !== "agent_message_chunk") {
            if (context.lastUpdateType === "agent_thought_chunk") {
                renderer.flush();
            }
            process.stdout.write("\n\x1b[1;36m❯ Agent:\x1b[0m ");
            renderer.reset();
        }
        renderer.setUpdateType(type);
        renderer.write(update.content.text);
    } else if (type === "tool_call") {
        if (context.lastUpdateType === "agent_thought_chunk" || context.lastUpdateType === "agent_message_chunk") {
            renderer.flush();
        }
        context.toolCalls.set(update.toolCallId, update.title);
        process.stdout.write(`\n\x1b[33m🔧 [Tool Call: ${update.title} (ID: ${update.toolCallId}) -> ${update.status || "pending"}]\x1b[0m\n`);
    } else if (type === "tool_call_update") {
        if (update.title) {
            context.toolCalls.set(update.toolCallId, update.title);
        }
        const title = context.toolCalls.get(update.toolCallId) || "unknown";
        process.stdout.write(`\n\x1b[33m🔧 [Tool Call Update: ${title} (ID: ${update.toolCallId}) -> ${update.status || "pending"}]\x1b[0m\n`);
    }

    context.lastUpdateType = type;
}

async function initializeSession(connection) {
    console.log("Sending initialize request...");
    const initResult = await connection.request(acp.methods.agent.initialize, {
        protocolVersion: 1,
        clientCapabilities: {}
    });
    console.log("✓ Handshake Negotiated. Protocol Version:", initResult.protocolVersion);

    console.log("Creating new session...");
    const sessionResult = await connection.request(acp.methods.agent.session.new, {});
    const sessionId = sessionResult.sessionId;
    console.log("✓ Session Created. ID:", sessionId);
    return sessionId;
}

function printReplHeader() {
    console.log("\n\x1b[1;36m┌────────────────────────────────────────────────────────┐");
    console.log("│           COMA INTERACTIVE ACP CLIENT (REPL)           │");
    console.log("└────────────────────────────────────────────────────────┘\x1b[0m");
    console.log("\x1b[90mInstructions: Type your prompt and press Enter. Type 'exit' to quit.\x1b[0m\n");
}

async function runInteractiveRepl(connection, sessionId, context) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise((resolve) => {
        const askPrompt = () => {
            rl.question("\n\x1b[1;32m❯ User:\x1b[0m ", async (promptInput) => {
                const trimmed = promptInput.trim();
                if (trimmed.toLowerCase() === "exit") {
                    console.log("Exiting ACP Client session...");
                    rl.close();
                    context.child.kill();
                    resolve();
                    return;
                }

                if (trimmed.length === 0) {
                    askPrompt();
                    return;
                }

                try {
                    const result = await connection.request(acp.methods.agent.session.prompt, {
                        sessionId: sessionId,
                        prompt: trimmed
                    });
                    context.renderer.flush();
                    context.lastUpdateType = null;
                    console.log(`\n\x1b[90m[Response Completed. Stop Reason: ${result.stopReason}]\x1b[0m`);
                } catch (err) {
                    console.error("\nError sending prompt:", err);
                }
                askPrompt();
            });
        };

        askPrompt();
    });
}

async function main() {
    const child = spawnComaProcess();
    const stream = setupNdJsonStream(child);

    const context = {
        toolCalls: new Map(),
        lastUpdateType: null,
        renderer: new MarkdownStreamRenderer(),
        child
    };

    await acp.client({ name: "test-client" })
        .onRequest(acp.methods.client.session.requestPermission, handleRequestPermission)
        .onNotification(acp.methods.client.session.update, (ctx) => handleSessionUpdate(ctx, context))
        .connectWith(stream, async (connection) => {
            const sessionId = await initializeSession(connection);
            printReplHeader();
            await runInteractiveRepl(connection, sessionId, context);
        });
}

main().catch((err) => {
    console.error("Test failed with error:", err);
    process.exit(1);
});
