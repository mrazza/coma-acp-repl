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
            this.output("\x1b[90m");
        } else {
            this.output("\x1b[0m");
        }

        if (this.inHeader > 0) {
            const headerStyles = {
                1: "\x1b[1;35m",
                2: "\x1b[1;36m",
                3: "\x1b[1;33m",
                4: "\x1b[1;32m"
            };
            this.output(headerStyles[this.inHeader] || headerStyles[4]);
        }

        if (this.inBlockquote) {
            this.output("\x1b[3m");
        }

        if (this.inCodeBlock || this.inInlineCode) {
            this.output("\x1b[33m");
        }

        if (this.inBold) {
            this.output("\x1b[1m");
        }

        if (this.inItalic) {
            this.output("\x1b[3m");
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
                this.output(`\n\x1b[33m└${"─".repeat(Math.max(0, width - 1))}\x1b[0m\n`);
                this.restoreStyle();
            } else {
                if (this.pendingCodeBlockBorder) {
                    this.output("\x1b[33m│ \x1b[0m");
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
                    this.output("\x1b[33m");
                } else {
                    this.output("\x1b[0m");
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
                this.output("\x1b[1m\x1b[3m");
            } else {
                this.output("\x1b[0m");
                this.restoreStyle();
            }
        } else if (count === 2) {
            this.inBold = !this.inBold;
            if (this.inBold) {
                this.output("\x1b[1m");
            } else {
                this.output("\x1b[0m");
                this.restoreStyle();
            }
        } else if (count === 1) {
            this.inItalic = !this.inItalic;
            if (this.inItalic) {
                this.output("\x1b[3m");
            } else {
                this.output("\x1b[23m");
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
        if (/^#{1,6} ?$/.test(str)) return true;
        if (/^ *(> *)+$/.test(str)) return true;
        if (/^ *[\-\*] ?$/.test(str)) return true;
        if (/^ *\d+(\. ?)?$/.test(str) && !/^ *\d+ $/.test(str)) return true;
        if (/^ *(\-+|\*+|\_+)[ \-\*\_]*$/.test(str)) return true;
        if (/^ *`{1,10}$/.test(str)) return true;
        if (/^ {1,4}$/.test(str)) return true;
        return false;
    }

    isHorizontalRule(buf) {
        if (!buf || typeof buf !== "string") return false;
        const trimmed = buf.trim();
        if (trimmed.length < 3) return false;

        if (/^[\- ]+$/.test(trimmed)) {
            const count = (trimmed.match(/-/g) || []).length;
            return count >= 3;
        }
        if (/^[\* ]+$/.test(trimmed)) {
            const count = (trimmed.match(/\*/g) || []).length;
            return count >= 3;
        }
        if (/^[\_ ]+$/.test(trimmed)) {
            const count = (trimmed.match(/_/g) || []).length;
            return count >= 3;
        }
        return false;
    }

    printHorizontalRule() {
        const width = this.getWidth();
        this.output(`\n\x1b[90m${"─".repeat(width)}\x1b[0m\n`);
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
        const buf = this.lineStartBuf;
        if (buf.endsWith(' ')) {
            // 1. Headers: ^(#{1,6}) $
            const headerMatch = buf.match(/^(#{1,6}) $/);
            if (headerMatch) {
                const level = headerMatch[1].length;
                this.inHeader = level;
                this.lineStart = false;
                this.lineStartBuf = "";

                const prefixes = {
                    1: "\x1b[1;35m█ ",
                    2: "\x1b[1;36m■ ",
                    3: "\x1b[1;33m▲ ",
                    4: "\x1b[1;32m○ "
                };
                this.output(prefixes[level] || prefixes[4]);
                return true;
            }

            // 2. Blockquotes: ^( *)((?:> *)+)$
            const bqMatch = buf.match(/^( *)((?:> *)+)$/);
            if (bqMatch) {
                const spaces = bqMatch[1];
                const level = (bqMatch[2].match(/>/g) || []).length;
                const bars = "\x1b[90m│ ".repeat(level);
                this.output(`${spaces}${bars}\x1b[3m`);
                this.inBlockquote = true;
                this.lineStart = false;
                this.lineStartBuf = "";
                return true;
            }

            // 3. Bullet lists: ^( *)[\-\*] $
            const bulletMatch = buf.match(/^( *)[\-\*] $/);
            if (bulletMatch) {
                const spaces = bulletMatch[1];
                this.output(`${spaces}\x1b[32m•\x1b[0m `);
                this.restoreStyle();
                this.lineStart = false;
                this.lineStartBuf = "";
                return true;
            }

            // 4. Numbered lists: ^( *)(\d+)\. $
            const numMatch = buf.match(/^( *)(\d+)\. $/);
            if (numMatch) {
                const spaces = numMatch[1];
                const num = numMatch[2];
                this.output(`${spaces}\x1b[36m${num}.\x1b[0m `);
                this.restoreStyle();
                this.lineStart = false;
                this.lineStartBuf = "";
                return true;
            }
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
            this.output(`\x1b[33m${prefix}${"─".repeat(remaining)}\x1b[0m\n`);
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
                this.output("\x1b[33m│ \x1b[0m");
                this.restoreStyle();
            }
            this.output('\n');
            this.pendingCodeBlockBorder = true;
            this.lineStart = true;
        } else {
            if (this.pendingCodeBlockBorder) {
                this.output("\x1b[33m│ \x1b[0m");
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
                this.output("\x1b[0m");
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
            this.output("\x1b[0m");
        }
        if (this.inCodeBlock) {
            const width = this.getWidth();
            this.output(`\n\x1b[33m└${"─".repeat(Math.max(0, width - 1))}\x1b[0m\n`);
        }
        this.reset();
    }
}