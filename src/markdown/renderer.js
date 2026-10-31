import { ANSI } from "../ui/ansi.js";
import {
    HEADER_STYLES,
    isPlausibleLineStart,
    isHorizontalRule,
    matchBlockPrefix
} from "./patterns.js";

/**
 * Character-by-character streaming Markdown renderer for the terminal.
 * Formats headers, blockquotes, bullet/numbered lists, inline formatting,
 * and framed code blocks in real time.
 */
export class MarkdownStreamRenderer {
    constructor(options = {}) {
        if (typeof options === "function") {
            this.options = { output: options };
        } else {
            this.options = options || {};
        }

        if (typeof this.options.output === "function") {
            this.output = this.options.output;
        } else if (this.options.output && typeof this.options.output.write === "function") {
            this.output = (str) => this.options.output.write(str);
        } else {
            this.output = (str) => process.stdout.write(str);
        }

        this.reset();
    }

    getWidth() {
        if (typeof this.options.width === "number" && this.options.width > 0) {
            return this.options.width;
        }
        const cols = (typeof process !== "undefined" && process.stdout && process.stdout.columns) || 60;
        return Math.min(cols, 80);
    }

    reset() {
        this.currentType = null;
        this.inCodeBlock = false;
        this.inInlineCode = false;
        this.inBold = false;
        this.inItalic = false;
        this.backtickCount = 0;
        this.asteriskCount = 0;

        // Line-oriented markdown states
        this.lineStart = true;
        this.lineStartBuf = "";
        this.inHeader = 0;
        this.inBlockquote = false;

        // Code block language reading & borders
        this.readingLangId = false;
        this.langIdBuf = "";
        this.pendingCodeBlockBorder = false;
        this.codeFenceLength = 0;
        this.backticksAtLineStart = false;
    }

    setUpdateType(type) {
        if (this.currentType !== type) {
            this.currentType = type;
            this.restoreStyle();
        }
    }

    restoreStyle() {
        if (this.currentType === "agent_thought_chunk") {
            this.output(ANSI.dim);
        } else {
            this.output(ANSI.reset);
        }

        if (this.inHeader > 0) {
            this.output(HEADER_STYLES[this.inHeader] || HEADER_STYLES[4]);
        }

        if (this.inBlockquote) {
            this.output(ANSI.italic);
        }

        if (this.inCodeBlock || this.inInlineCode) {
            this.output(ANSI.yellow);
        }

        if (this.inBold) {
            this.output(ANSI.bold);
        }

        if (this.inItalic) {
            this.output(ANSI.italic);
        }
    }

    flushBackticks() {
        const count = this.backtickCount;
        if (count === 0) return;
        this.backtickCount = 0;

        if (this.inCodeBlock) {
            if (this.backticksAtLineStart && count >= this.codeFenceLength) {
                this.inCodeBlock = false;
                this.codeFenceLength = 0;
                this.pendingCodeBlockBorder = false;
                const width = this.getWidth();
                this.output(`${ANSI.yellow}└${"─".repeat(Math.max(0, width - 1))}${ANSI.reset}\n`);
                this.restoreStyle();
            } else {
                if (this.pendingCodeBlockBorder) {
                    this.output(`${ANSI.yellow}│ ${ANSI.reset}`);
                    this.restoreStyle();
                    this.pendingCodeBlockBorder = false;
                }
                this.output('`'.repeat(count));
            }
            return;
        }

        if (count >= 3) {
            this.inCodeBlock = true;
            this.codeFenceLength = count;
            this.readingLangId = true;
            this.langIdBuf = "";
        } else {
            if (count === 1) {
                this.inInlineCode = !this.inInlineCode;
                if (this.inInlineCode) {
                    this.output(ANSI.yellow);
                } else {
                    this.output(ANSI.reset);
                    this.restoreStyle();
                }
            } else {
                this.output('`'.repeat(count));
            }
        }
    }

    flushAsterisks() {
        const count = this.asteriskCount;
        if (count === 0) return;
        this.asteriskCount = 0;

        if (count === 3) {
            this.inBold = !this.inBold;
            this.inItalic = !this.inItalic;
            if (this.inBold && this.inItalic) {
                this.output(`${ANSI.bold}${ANSI.italic}`);
            } else {
                this.output(ANSI.reset);
                this.restoreStyle();
            }
        } else if (count === 2) {
            this.inBold = !this.inBold;
            if (this.inBold) {
                this.output(ANSI.bold);
            } else {
                this.output(ANSI.reset);
                this.restoreStyle();
            }
        } else if (count === 1) {
            this.inItalic = !this.inItalic;
            if (this.inItalic) {
                this.output(ANSI.italic);
            } else {
                this.output(ANSI.italicOff);
            }
        } else {
            this.output('*'.repeat(count));
        }
    }

    flushLineStartBuf() {
        if (this.lineStartBuf.length === 0) return;
        const temp = this.lineStartBuf;
        this.lineStartBuf = "";
        for (let i = 0; i < temp.length; i++) {
            this.printChar(temp[i]);
        }
    }

    isPlausibleLineStart(str) {
        return isPlausibleLineStart(str);
    }

    isHorizontalRule(buf) {
        return isHorizontalRule(buf);
    }

    printHorizontalRule() {
        const width = this.getWidth();
        this.output(`\n${ANSI.dim}${"─".repeat(width)}${ANSI.reset}\n`);
    }

    printChar(char) {
        if (char === '`') {
            this.flushAsterisks();
            this.backtickCount++;
            return;
        }
        if (char === '*') {
            this.flushBackticks();
            this.asteriskCount++;
            return;
        }

        this.flushBackticks();
        this.flushAsterisks();

        if (this.readingLangId) {
            this.handleReadingLangId(char);
            return;
        }

        this.output(char);
    }

    tryMatchBlockPattern() {
        const match = matchBlockPrefix(this.lineStartBuf);
        if (!match) return false;

        if (match.type === "header") {
            this.inHeader = match.level;
            this.lineStart = false;
            this.lineStartBuf = "";
            this.output(match.prefix);
            return true;
        }

        if (match.type === "blockquote") {
            this.inBlockquote = true;
            this.lineStart = false;
            this.lineStartBuf = "";
            this.output(match.prefix);
            return true;
        }

        if (match.type === "bullet") {
            this.lineStart = false;
            this.lineStartBuf = "";
            this.output(match.prefix);
            this.restoreStyle();
            return true;
        }

        if (match.type === "numbered") {
            this.lineStart = false;
            this.lineStartBuf = "";
            this.output(match.prefix);
            this.restoreStyle();
            return true;
        }

        return false;
    }

    write(text) {
        if (!text || typeof text !== "string") return;

        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            if (char === '\r') continue;

            if (this.readingLangId) {
                this.handleReadingLangId(char);
                continue;
            }

            if (this.inCodeBlock) {
                this.handleCodeBlockChar(char);
                continue;
            }

            if (this.lineStart) {
                if (this.handleLineStartChar(char)) {
                    continue;
                }
            }

            this.handleNormalChar(char);
        }
    }

    handleReadingLangId(char) {
        if (char === '\n') {
            this.readingLangId = false;
            const lang = this.langIdBuf.trim();
            const width = this.getWidth();
            const prefix = lang ? `┌── Code (${lang}) ` : `┌── Code `;
            const remaining = Math.max(0, width - prefix.length);
            this.output(`${ANSI.yellow}${prefix}${"─".repeat(remaining)}${ANSI.reset}\n`);
            this.lineStart = true;
            this.pendingCodeBlockBorder = true;
        } else {
            if (this.langIdBuf.length < 16) {
                this.langIdBuf += char;
            }
        }
    }

    handleCodeBlockChar(char) {
        if (char === '`') {
            if (this.backtickCount === 0) {
                this.backticksAtLineStart = this.lineStart;
            }
            this.backtickCount++;
            return;
        }

        const wasInCodeBlock = this.inCodeBlock;
        this.flushBackticks();

        if (wasInCodeBlock && !this.inCodeBlock) {
            this.lineStart = true;
            return;
        }

        if (char === '\n') {
            if (this.pendingCodeBlockBorder) {
                this.output(`${ANSI.yellow}│ ${ANSI.reset}`);
                this.restoreStyle();
            }
            this.output('\n');
            this.pendingCodeBlockBorder = true;
            this.lineStart = true;
        } else {
            if (this.pendingCodeBlockBorder) {
                this.output(`${ANSI.yellow}│ ${ANSI.reset}`);
                this.restoreStyle();
                this.pendingCodeBlockBorder = false;
            }
            this.output(char);
            this.lineStart = false;
        }
    }

    handleLineStartChar(char) {
        if (char === '\n') {
            if (this.isHorizontalRule(this.lineStartBuf)) {
                this.printHorizontalRule();
                this.lineStartBuf = "";
                this.lineStart = true;
                return true;
            }
            this.flushLineStartBuf();
            this.printChar('\n');
            this.lineStart = true;
            return true;
        }

        const candidate = this.lineStartBuf + char;
        if (this.isPlausibleLineStart(candidate)) {
            if (candidate.length < 16) {
                this.lineStartBuf = candidate;
                if (this.tryMatchBlockPattern()) {
                    return true;
                }
                return true;
            }
        }

        this.flushLineStartBuf();
        this.lineStart = false;
        return false;
    }

    handleNormalChar(char) {
        if (char === '\n') {
            let resetNeeded = false;
            if (this.inHeader > 0) {
                this.inHeader = 0;
                resetNeeded = true;
            }
            if (this.inBlockquote) {
                this.inBlockquote = false;
                resetNeeded = true;
            }
            if (resetNeeded) {
                this.output(ANSI.reset);
                this.restoreStyle();
            }

            this.printChar('\n');
            this.lineStart = true;
        } else {
            this.printChar(char);
        }
    }

    flush() {
        if (this.isHorizontalRule(this.lineStartBuf)) {
            this.printHorizontalRule();
            this.lineStartBuf = "";
        }
        this.flushLineStartBuf();
        this.flushBackticks();
        this.flushAsterisks();
        if (this.inHeader > 0 || this.inBlockquote || this.inBold || this.inItalic || this.inInlineCode) {
            this.output(ANSI.reset);
        }
        if (this.inCodeBlock) {
            const width = this.getWidth();
            const prefix = this.lineStart ? "" : "\n";
            this.output(`${prefix}${ANSI.yellow}└${"─".repeat(Math.max(0, width - 1))}${ANSI.reset}\n`);
        }
        this.reset();
    }
}
