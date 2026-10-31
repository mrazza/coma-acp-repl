import * as acp from "@agentclientprotocol/sdk";
import { ANSI } from "../ui/ansi.js";
import { formatToolInput, formatToolOutput, formatToolContent } from "../ui/formatters.js";

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
 * Prompts the user interactively when an ACP permission request is received.
 */
export async function handleRequestPermission(ctx, context = {}) {
    const params = ctx?.params;
    const toolTitle = params?.toolCall?.title || "Tool Call";
    const options = params?.options || [];

    if (context.spinner && typeof context.spinner.stop === "function") {
        context.spinner.stop();
    }

    process.stdout.write(`\n${ANSI.boldYellow}⚠️  [Permission Requested]${ANSI.reset}\n`);
    process.stdout.write(`Tool: ${ANSI.bold}${toolTitle}${ANSI.reset}\n`);
    if (params?.toolCall?.rawInput) {
        const inputStr = formatToolInput(params.toolCall.rawInput);
        if (inputStr) {
            process.stdout.write(`${ANSI.dim}Args: ${inputStr}${ANSI.reset}\n`);
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
        process.stdout.write(`  [${idx + 1}] ${opt.name}${isDefault ? ` ${ANSI.green}(Default: Enter)${ANSI.reset}` : ""}\n`);
    });

    if (!context.rl) {
        return { outcome: { outcome: "cancelled" } };
    }

    try {
        const answer = await context.rl.question(`Select option [1-${options.length}] or 'n' to cancel: `);
        const trimmed = (answer || "").trim().toLowerCase();

        if (trimmed === "n" || trimmed === "cancel" || trimmed === "reject") {
            process.stdout.write(`${ANSI.dim}Permission cancelled by user.${ANSI.reset}\n`);
            return { outcome: { outcome: "cancelled" } };
        }

        if (trimmed === "") {
            const selected = options[defaultIndex];
            process.stdout.write(`${ANSI.green}Selected: ${selected.name}${ANSI.reset}\n`);
            return { outcome: { outcome: "selected", optionId: selected.optionId } };
        }

        const num = parseInt(trimmed, 10);
        if (!isNaN(num) && num >= 1 && num <= options.length) {
            const selected = options[num - 1];
            process.stdout.write(`${ANSI.green}Selected: ${selected.name}${ANSI.reset}\n`);
            return { outcome: { outcome: "selected", optionId: selected.optionId } };
        }

        process.stdout.write(`${ANSI.red}Invalid option selected. Cancelling request.${ANSI.reset}\n`);
        return { outcome: { outcome: "cancelled" } };
    } catch {
        return { outcome: { outcome: "cancelled" } };
    }
}

/**
 * Handles agent thought chunks in session updates.
 */
export function handleThoughtChunk(update, context) {
    const renderer = context.renderer;
    if (context.showThoughts !== false) {
        if (context.lastUpdateType !== "agent_thought_chunk") {
            if (context.lastUpdateType === "agent_message_chunk") {
                renderer?.flush();
            }
            if (context.lastUpdateType) {
                process.stdout.write("\n");
            }
            process.stdout.write(`${ANSI.dim}Thinking...${ANSI.reset}\n`);
            renderer?.reset();
        }
        renderer?.setUpdateType("agent_thought_chunk");
        if (update.content?.type === "text" && typeof update.content.text === "string") {
            renderer?.write(update.content.text);
        } else if (update.content?.type) {
            process.stdout.write(`\n${ANSI.magenta}[Content: ${update.content.type}]${ANSI.reset}\n`);
        }
    }
    if (context.currentTurn && update.content?.text) {
        context.currentTurn.thoughts = (context.currentTurn.thoughts || "") + update.content.text;
    }
}

/**
 * Handles agent message chunks in session updates.
 */
export function handleMessageChunk(update, context) {
    const renderer = context.renderer;
    if (context.lastUpdateType !== "agent_message_chunk") {
        if (context.lastUpdateType === "agent_thought_chunk") {
            renderer?.flush();
        }
        process.stdout.write(`\n${ANSI.boldCyan}❯ Agent:${ANSI.reset} `);
        renderer?.reset();
    }
    renderer?.setUpdateType("agent_message_chunk");
    if (update.content?.type === "text" && typeof update.content.text === "string") {
        renderer?.write(update.content.text);
    } else if (update.content?.type) {
        process.stdout.write(`\n${ANSI.magenta}[Content: ${update.content.type}]${ANSI.reset}\n`);
    }
    if (context.currentTurn && update.content?.text) {
        context.currentTurn.agentResponse = (context.currentTurn.agentResponse || "") + update.content.text;
    }
}

/**
 * Handles tool call creations and status updates.
 */
export function handleToolCallUpdate(update, context) {
    const renderer = context.renderer;
    if (context.lastUpdateType === "agent_thought_chunk" || context.lastUpdateType === "agent_message_chunk") {
        renderer?.flush();
    }

    let tool = context.toolCalls?.get(update.toolCallId);
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
        context.toolCalls?.set(update.toolCallId, tool);
    } else {
        if (update.title) tool.title = update.title;
        if (update.kind) tool.kind = update.kind;
        if (update.status) tool.status = update.status;
        if (update.rawInput !== undefined) tool.rawInput = update.rawInput;
        if (update.rawOutput !== undefined) tool.rawOutput = update.rawOutput;
        if (update.content !== undefined) tool.content = update.content;
    }

    if (context.currentTurn && context.currentTurn.toolCalls) {
        const exists = context.currentTurn.toolCalls.some((t) => t.toolCallId === tool.toolCallId);
        if (!exists) {
            context.currentTurn.toolCalls.push(tool);
        }
    }

    if (tool.status === "in_progress" || tool.status === "pending") {
        if (isNew || tool._loggedState !== "started") {
            tool._loggedState = "started";
            process.stdout.write(`\n${ANSI.yellow}🔧 [Tool Call: ${tool.title} (ID: ${tool.toolCallId}) -> ${tool.status}]${ANSI.reset}\n`);
            if (tool.rawInput) {
                const formatted = formatToolInput(tool.rawInput);
                if (formatted) {
                    process.stdout.write(`${ANSI.dim}  Args: ${formatted}${ANSI.reset}\n`);
                }
            }
            if (context.spinner) {
                context.spinner.start(`Running ${tool.title}...`);
            }
        }
    } else if (tool.status === "completed" || tool.status === "failed") {
        tool._loggedState = tool.status;
        const icon = tool.status === "completed" ? `${ANSI.green}✓` : `${ANSI.red}✗`;
        process.stdout.write(`\n${icon} [Tool ${tool.status === "completed" ? "Completed" : "Failed"}: ${tool.title} (ID: ${tool.toolCallId})]${ANSI.reset}\n`);

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
}

/**
 * Handles plan updates and displays steps.
 */
export function handlePlanUpdate(update, context) {
    const renderer = context.renderer;
    if (context.lastUpdateType === "agent_thought_chunk" || context.lastUpdateType === "agent_message_chunk") {
        renderer?.flush();
    }
    const entries = update.entries || update.plan?.entries;
    if (Array.isArray(entries) && entries.length > 0) {
        process.stdout.write(`\n${ANSI.boldBlue}📋 [Plan Update]${ANSI.reset}\n`);
        for (const entry of entries) {
            const statusIcon = entry.status === "completed" ? `${ANSI.green}✓${ANSI.reset}`
                : entry.status === "in_progress" ? `${ANSI.yellow}▶${ANSI.reset}`
                : `${ANSI.dim}○${ANSI.reset}`;
            const priorityBadge = entry.priority ? ` ${ANSI.dim}(${entry.priority})${ANSI.reset}` : "";
            process.stdout.write(`  ${statusIcon} ${entry.content}${priorityBadge}\n`);
        }
    }
}

/**
 * Handles token usage and cost updates.
 */
export function handleUsageUpdate(update, context) {
    const renderer = context.renderer;
    if (context.lastUpdateType === "agent_thought_chunk" || context.lastUpdateType === "agent_message_chunk") {
        renderer?.flush();
    }
    const costStr = update.cost ? ` | Cost: $${typeof update.cost === "object" ? JSON.stringify(update.cost) : update.cost}` : "";
    process.stdout.write(`\n${ANSI.dim}📊 [Usage: ${update.used} / ${update.size} tokens${costStr}]${ANSI.reset}\n`);
}

/**
 * Handles agent mode switch updates.
 */
export function handleModeUpdate(update, context) {
    const renderer = context.renderer;
    if (context.lastUpdateType === "agent_thought_chunk" || context.lastUpdateType === "agent_message_chunk") {
        renderer?.flush();
    }
    if (update.currentModeId) {
        process.stdout.write(`\n${ANSI.blue}🔀 [Mode switched to: ${update.currentModeId}]${ANSI.reset}\n`);
    }
}

/**
 * Handles incoming ACP session updates and renders styled terminal output.
 */
export function handleSessionUpdate(notification, context) {
    const update = notification?.update;
    if (!update) return;

    const type = update.sessionUpdate;

    if (context.spinner && typeof context.spinner.stop === "function") {
        context.spinner.stop();
    }

    if (type === "agent_thought_chunk") {
        handleThoughtChunk(update, context);
    } else if (type === "agent_message_chunk") {
        handleMessageChunk(update, context);
    } else if (type === "tool_call" || type === "tool_call_update") {
        handleToolCallUpdate(update, context);
    } else if (type === "plan" || type === "plan_update") {
        handlePlanUpdate(update, context);
    } else if (type === "usage_update") {
        handleUsageUpdate(update, context);
    } else if (type === "current_mode_update") {
        handleModeUpdate(update, context);
    }

    context.lastUpdateType = type;
}
