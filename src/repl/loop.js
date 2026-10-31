import * as acp from "@agentclientprotocol/sdk";
import readlinePromises from "readline/promises";
import { ANSI } from "../ui/ansi.js";
import { expandFileMentions } from "./context.js";
import { handleSlashCommand } from "./commands.js";
import { handleSessionUpdate } from "../acp/handlers.js";

/**
 * Reads user prompt input, supporting multiline input via trailing backslash (\).
 */
export async function readPromptInput(rl) {
    let fullInput = "";
    let promptString = `\n${ANSI.boldGreen}❯ User:${ANSI.reset} `;

    while (true) {
        const line = await rl.question(promptString);
        if (line === null || line === undefined) {
            return null;
        }

        const trimmedEnd = line.trimEnd();
        if (trimmedEnd.endsWith("\\")) {
            fullInput += trimmedEnd.slice(0, -1) + "\n";
            promptString = `${ANSI.dim}... ${ANSI.reset}`;
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
            process.stdout.write(`\n${ANSI.yellow}[Cancelling prompt turn...]${ANSI.reset}\n`);
            context.abortTurn = true;
            context.turnAbortController?.abort();
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

        const { blocks, filesAttached, filesSkipped } = expandFileMentions(trimmed, context.cwd);
        if (filesAttached.length > 0) {
            process.stdout.write(`${ANSI.dim}[Attached context from: ${filesAttached.map((f) => f.relativePath).join(", ")}]${ANSI.reset}\n`);
        }
        if (filesSkipped?.length > 0) {
            process.stdout.write(`${ANSI.dim}[Skipped @file mentions: ${filesSkipped.map((f) => `${f.relativePath} (${f.reason})`).join(", ")}]${ANSI.reset}\n`);
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
        const turnAbortController = new AbortController();
        context.turnAbortController = turnAbortController;
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
                context.renderer?.flush();
                context.lastUpdateType = null;
                currentTurn.stopReason = result.stopReason;
                console.log(`\n${ANSI.dim}[Response Completed. Stop Reason: ${result.stopReason}]${ANSI.reset}`);
            } else {
                promptPromise.catch(() => {});
                context.renderer?.flush();
                context.lastUpdateType = null;
                currentTurn.stopReason = "cancelled";
                console.log(`\n${ANSI.yellow}[Turn Cancelled]${ANSI.reset}`);
            }
        } catch (err) {
            if (context.spinner) context.spinner.stop();
            context.renderer?.flush();
            context.lastUpdateType = null;
            console.error("\nError sending prompt:", err);
        } finally {
            context.isTurnRunning = false;
            context.cancelTurnPromiseResolve = null;
            context.turnAbortController = null;
            context.abortTurn = false;
        }
    }

    rl.close();
    if (context.child) {
        context.child.kill();
    }
}
