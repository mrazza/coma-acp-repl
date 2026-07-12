export class MarkdownStreamRenderer {
    constructor() {
        this.reset();
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

        // Code block language reading
        this.readingLangId = false;
        this.langIdBuf = "";
        this.pendingCodeBlockBorder = false;
    }

    setUpdateType(type) {
        if (this.currentType !== type) {
            this.currentType = type;
            this.restoreStyle();
        }
    }

    restoreStyle() {
        if (this.inCodeBlock) {
            process.stdout.write("\x1b[33m");
        } else if (this.inInlineCode) {
            process.stdout.write("\x1b[33m");
        } else {
            if (this.currentType === "agent_thought_chunk") {
                process.stdout.write("\x1b[90m");
            } else {
                process.stdout.write("\x1b[0m");
            }
        }
    }

    flushBackticks() {
        const count = this.backtickCount;
        if (count === 0) return;
        this.backtickCount = 0;

        if (count === 3) {
            this.inCodeBlock = !this.inCodeBlock;
            if (this.inCodeBlock) {
                this.readingLangId = true;
                this.langIdBuf = "";
            } else {
                process.stdout.write(`\n\x1b[33m└──────────────────────────────────────────────────────────\x1b[0m\n`);
                this.pendingCodeBlockBorder = false;
                this.restoreStyle();
            }
        } else {
            if (this.inCodeBlock) {
                if (this.pendingCodeBlockBorder) {
                    process.stdout.write(`\x1b[33m│ \x1b[0m`);
                    this.pendingCodeBlockBorder = false;
                }
                process.stdout.write('`'.repeat(count));
            } else {
                if (count === 1) {
                    this.inInlineCode = !this.inInlineCode;
                    if (this.inInlineCode) {
                        process.stdout.write(`\x1b[33m`);
                    } else {
                        process.stdout.write(`\x1b[0m`);
                        this.restoreStyle();
                    }
                } else {
                    process.stdout.write('`'.repeat(count));
                }
            }
        }
    }

    flushAsterisks() {
        const count = this.asteriskCount;
        if (count === 0) return;
        this.asteriskCount = 0;

        if (count === 2) {
            this.inBold = !this.inBold;
            if (this.inBold) {
                process.stdout.write(`\x1b[1m`);
            } else {
                process.stdout.write(`\x1b[0m`);
                this.restoreStyle();
            }
        } else if (count === 1) {
            this.inItalic = !this.inItalic;
            if (this.inItalic) {
                process.stdout.write(`\x1b[3m`);
            } else {
                process.stdout.write(`\x1b[23m`);
            }
        } else {
            process.stdout.write('*'.repeat(count));
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

    isHorizontalRule(buf) {
        const trimmed = buf.trim();
        if (trimmed.length < 3) return false;
        return /^[\- ]+$/.test(trimmed) || /^[\* ]+$/.test(trimmed);
    }

    printHorizontalRule() {
        process.stdout.write(`\n\x1b[90m──────────────────────────────────────────────────\x1b[0m\n`);
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
            if (this.langIdBuf.length < 16) {
                this.langIdBuf += char;
            }
            return;
        }

        process.stdout.write(char);
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
                process.stdout.write(prefixes[level] || prefixes[4]);
                return true;
            }

            // 2. Blockquotes: ^( *)> $
            const bqMatch = buf.match(/^( *)> $/);
            if (bqMatch) {
                const spaces = bqMatch[1];
                process.stdout.write(`${spaces}\x1b[90m│ \x1b[3m`);
                this.inBlockquote = true;
                this.lineStart = false;
                this.lineStartBuf = "";
                return true;
            }

            // 3. Bullet lists: ^( *)[\-\*] $
            const bulletMatch = buf.match(/^( *)[\-\*] $/);
            if (bulletMatch) {
                const spaces = bulletMatch[1];
                process.stdout.write(`${spaces}\x1b[32m•\x1b[0m `);
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
                process.stdout.write(`${spaces}\x1b[36m${num}.\x1b[0m `);
                this.restoreStyle();
                this.lineStart = false;
                this.lineStartBuf = "";
                return true;
            }
        }
        return false;
    }

    write(text) {
        this.restoreStyle();
        for (let i = 0; i < text.length; i++) {
            const char = text[i];

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
            if (lang) {
                process.stdout.write(`\x1b[33m┌── Code (${lang}) ──────────────────────────────────────────────────\x1b[0m\n`);
            } else {
                process.stdout.write(`\x1b[33m┌── Code ──────────────────────────────────────────────────\x1b[0m\n`);
            }
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
            this.backtickCount++;
            return;
        }

        this.flushBackticks();

        if (char === '\n') {
            process.stdout.write('\n');
            this.pendingCodeBlockBorder = true;
            this.lineStart = true;
        } else {
            if (this.pendingCodeBlockBorder) {
                process.stdout.write(`\x1b[33m│ \x1b[0m`);
                this.pendingCodeBlockBorder = false;
            }
            process.stdout.write(char);
        }
    }

    handleLineStartChar(char) {
        const isPrefixChar = /^[#>\-\*\. 0-9\r]$/.test(char);
        if (isPrefixChar) {
            if (this.lineStartBuf.length < 16) {
                this.lineStartBuf += char;
                if (this.tryMatchBlockPattern()) {
                    return true;
                }
                return true;
            } else {
                this.flushLineStartBuf();
                this.lineStart = false;
            }
        } else {
            if (char === '\n') {
                if (this.isHorizontalRule(this.lineStartBuf)) {
                    this.printHorizontalRule();
                    this.lineStartBuf = "";
                    this.lineStart = true;
                    return true;
                }
                this.flushLineStartBuf();
                this.printChar('\n');
                return true;
            }
            this.flushLineStartBuf();
            this.lineStart = false;
        }
        return false;
    }

    handleNormalChar(char) {
        if (char === '\n') {
            if (this.isHorizontalRule(this.lineStartBuf)) {
                this.printHorizontalRule();
                this.lineStartBuf = "";
                this.lineStart = true;
                return;
            }

            if (this.inHeader > 0) {
                process.stdout.write(`\x1b[0m`);
                this.inHeader = 0;
            }
            if (this.inBlockquote) {
                process.stdout.write(`\x1b[0m`);
                this.inBlockquote = false;
            }

            this.printChar('\n');
            this.lineStart = true;
        } else {
            this.printChar(char);
        }
    }

    flush() {
        this.flushBackticks();
        this.flushAsterisks();
        this.flushLineStartBuf();
        if (this.inHeader > 0 || this.inBlockquote || this.inBold || this.inItalic || this.inInlineCode) {
            process.stdout.write(`\x1b[0m`);
        }
        if (this.inCodeBlock) {
            process.stdout.write(`\n\x1b[33m└──────────────────────────────────────────────────────────\x1b[0m\n`);
        }
        this.reset();
    }
}
