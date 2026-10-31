import { ANSI } from "./ansi.js";

/**
 * Concisely formats raw tool arguments for terminal display.
 */
export function formatToolInput(rawInput) {
    if (rawInput === undefined || rawInput === null) return "";
    if (typeof rawInput === "string") return rawInput;
    try {
        if (typeof rawInput === "object") {
            if (rawInput.command && typeof rawInput.command === "string") {
                return `$ ${rawInput.command}`;
            }
            if (rawInput.path && typeof rawInput.path === "string") {
                return `path: ${rawInput.path}`;
            }
            return JSON.stringify(rawInput);
        }
        return String(rawInput);
    } catch {
        return String(rawInput);
    }
}

/**
 * Formats raw tool output for terminal display, with line truncation in non-verbose mode.
 */
export function formatToolOutput(rawOutput, verbose = false) {
    if (rawOutput === undefined || rawOutput === null) return "";
    let str = "";
    if (typeof rawOutput === "string") {
        str = rawOutput;
    } else {
        try {
            str = JSON.stringify(rawOutput, null, 2);
        } catch {
            str = String(rawOutput);
        }
    }

    const lines = str.split("\n");
    if (!verbose && lines.length > 10) {
        const preview = lines.slice(0, 10).map((l) => "    " + l).join("\n");
        const remaining = lines.length - 10;
        return `${preview}\n${ANSI.dim}    ... (${remaining} lines truncated. Use /verbose to see all)${ANSI.reset}`;
    }
    return lines.map((l) => "    " + l).join("\n");
}

/**
 * Formats tool content blocks if provided on tool updates.
 */
export function formatToolContent(contentArray, verbose = false) {
    if (!Array.isArray(contentArray) || contentArray.length === 0) return "";
    const parts = [];
    for (const item of contentArray) {
        if (item.type === "content" && item.content) {
            if (item.content.type === "text" && item.content.text) {
                parts.push(item.content.text);
            } else if (item.content.type) {
                parts.push(`[${item.content.type}]`);
            }
        } else if (item.type === "text" && item.text) {
            parts.push(item.text);
        } else if (item.type === "diff") {
            parts.push(`[Diff for ${item.path || "file"}]`);
        }
    }
    if (parts.length === 0) return "";
    return formatToolOutput(parts.join("\n"), verbose);
}
