import path from "path";
import fs from "fs";
import { formatToolInput } from "../ui/formatters.js";

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
