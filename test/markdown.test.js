import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { MarkdownStreamRenderer } from "../src/markdown/renderer.js";
import {
    HEADER_STYLES,
    HEADER_PREFIXES,
    isPlausibleLineStart,
    isHorizontalRule,
    matchBlockPrefix
} from "../src/markdown/patterns.js";

function createCaptureRenderer(options = {}) {
    let output = "";
    const renderer = new MarkdownStreamRenderer({
        output: (str) => {
            output += str;
        },
        ...options
    });
    return {
        renderer,
        getOutput: () => output,
        clearOutput: () => {
            output = "";
        }
    };
}

describe("Markdown Patterns (pure functions)", () => {
    describe("isPlausibleLineStart", () => {
        test("accepts plausible line starts for headers, lists, blockquotes, code fences", () => {
            assert.strictEqual(isPlausibleLineStart("#"), true);
            assert.strictEqual(isPlausibleLineStart("### "), true);
            assert.strictEqual(isPlausibleLineStart(">"), true);
            assert.strictEqual(isPlausibleLineStart(">> "), true);
            assert.strictEqual(isPlausibleLineStart("-"), true);
            assert.strictEqual(isPlausibleLineStart("* "), true);
            assert.strictEqual(isPlausibleLineStart("1"), true);
            assert.strictEqual(isPlausibleLineStart("1."), true);
            assert.strictEqual(isPlausibleLineStart("1. "), true);
            assert.strictEqual(isPlausibleLineStart("12."), true);
            assert.strictEqual(isPlausibleLineStart("---"), true);
            assert.strictEqual(isPlausibleLineStart("***"), true);
            assert.strictEqual(isPlausibleLineStart("```"), true);
            assert.strictEqual(isPlausibleLineStart("  "), true);
        });

        test("rejects non-prefix line starts", () => {
            assert.strictEqual(isPlausibleLineStart("2026 is"), false);
            assert.strictEqual(isPlausibleLineStart("hello world"), false);
            assert.strictEqual(isPlausibleLineStart("123 "), false);
            assert.strictEqual(isPlausibleLineStart(null), false);
            assert.strictEqual(isPlausibleLineStart(undefined), false);
            assert.strictEqual(isPlausibleLineStart(""), false);
        });
    });

    describe("isHorizontalRule", () => {
        test("recognizes horizontal rules with at least 3 markers", () => {
            assert.strictEqual(isHorizontalRule("---"), true);
            assert.strictEqual(isHorizontalRule("----"), true);
            assert.strictEqual(isHorizontalRule("- - -"), true);
            assert.strictEqual(isHorizontalRule("***"), true);
            assert.strictEqual(isHorizontalRule("* * *"), true);
            assert.strictEqual(isHorizontalRule("___"), true);
            assert.strictEqual(isHorizontalRule("_ _ _"), true);
            assert.strictEqual(isHorizontalRule("   ---   "), true);
        });

        test("rejects invalid or insufficient markers", () => {
            assert.strictEqual(isHorizontalRule("--"), false);
            assert.strictEqual(isHorizontalRule("- - "), false);
            assert.strictEqual(isHorizontalRule("**"), false);
            assert.strictEqual(isHorizontalRule("__"), false);
            assert.strictEqual(isHorizontalRule("-*-"), false);
            assert.strictEqual(isHorizontalRule("---abc"), false);
            assert.strictEqual(isHorizontalRule(""), false);
            assert.strictEqual(isHorizontalRule(null), false);
            assert.strictEqual(isHorizontalRule(undefined), false);
        });
    });

    describe("matchBlockPrefix", () => {
        test("matches headers 1 through 6", () => {
            const h1 = matchBlockPrefix("# ");
            assert.deepStrictEqual(h1, { type: "header", level: 1, prefix: HEADER_PREFIXES[1] });

            const h2 = matchBlockPrefix("## ");
            assert.deepStrictEqual(h2, { type: "header", level: 2, prefix: HEADER_PREFIXES[2] });

            const h3 = matchBlockPrefix("### ");
            assert.deepStrictEqual(h3, { type: "header", level: 3, prefix: HEADER_PREFIXES[3] });

            const h4 = matchBlockPrefix("#### ");
            assert.deepStrictEqual(h4, { type: "header", level: 4, prefix: HEADER_PREFIXES[4] });

            const h6 = matchBlockPrefix("###### ");
            assert.deepStrictEqual(h6, { type: "header", level: 6, prefix: HEADER_PREFIXES[4] });
        });

        test("matches blockquotes with single and nested bars", () => {
            const bq1 = matchBlockPrefix("> ");
            assert.strictEqual(bq1.type, "blockquote");
            assert.strictEqual(bq1.level, 1);
            assert.ok(bq1.prefix.includes("│ "));

            const bq2 = matchBlockPrefix(">> ");
            assert.strictEqual(bq2.type, "blockquote");
            assert.strictEqual(bq2.level, 2);
            assert.ok(bq2.prefix.includes("│ "));
        });

        test("matches bullet lists with - or *", () => {
            const b1 = matchBlockPrefix("- ");
            assert.strictEqual(b1.type, "bullet");
            assert.ok(b1.prefix.includes("•"));

            const b2 = matchBlockPrefix("* ");
            assert.strictEqual(b2.type, "bullet");
            assert.ok(b2.prefix.includes("•"));

            const b3 = matchBlockPrefix("  - ");
            assert.strictEqual(b3.type, "bullet");
            assert.strictEqual(b3.spaces, "  ");
        });

        test("matches numbered lists", () => {
            const num = matchBlockPrefix("1. ");
            assert.strictEqual(num.type, "numbered");
            assert.strictEqual(num.num, "1");
            assert.ok(num.prefix.includes("1."));

            const num2 = matchBlockPrefix("   42. ");
            assert.strictEqual(num2.type, "numbered");
            assert.strictEqual(num2.spaces, "   ");
            assert.strictEqual(num2.num, "42");
        });

        test("returns null for non-prefix buffers", () => {
            assert.strictEqual(matchBlockPrefix("not a prefix"), null);
            assert.strictEqual(matchBlockPrefix(""), null);
            assert.strictEqual(matchBlockPrefix(null), null);
            assert.strictEqual(matchBlockPrefix("###"), null); // No trailing space
        });
    });
});

describe("MarkdownStreamRenderer", () => {
    describe("Output Target & Constructor Injection", () => {
        test("accepts output function directly as options argument", () => {
            let captured = "";
            const renderer = new MarkdownStreamRenderer((str) => {
                captured += str;
            });
            renderer.write("hello world");
            renderer.flush();
            assert.strictEqual(captured, "hello world");
        });

        test("accepts options object with output callback", () => {
            let captured = "";
            const renderer = new MarkdownStreamRenderer({
                output: (str) => {
                    captured += str;
                }
            });
            renderer.write("testing");
            renderer.flush();
            assert.strictEqual(captured, "testing");
        });

        test("accepts options object with stream-like write method", () => {
            let captured = "";
            const fakeStream = {
                write(str) {
                    captured += str;
                }
            };
            const renderer = new MarkdownStreamRenderer({ output: fakeStream });
            renderer.write("stream output");
            renderer.flush();
            assert.strictEqual(captured, "stream output");
        });

        test("guards write(text) against null, undefined, numbers, and non-strings", () => {
            const { renderer, getOutput } = createCaptureRenderer();
            renderer.write(null);
            renderer.write(undefined);
            renderer.write(12345);
            renderer.write({});
            renderer.write([]);
            renderer.write(true);
            renderer.write("");
            assert.strictEqual(getOutput(), "");
        });
    });

    describe("Dynamic Terminal Width", () => {
        test("uses configurable options.width for horizontal rules", () => {
            const width = 45;
            const { renderer, getOutput } = createCaptureRenderer({ width });
            renderer.write("---\n");
            const expected = `\n\x1b[90m${"─".repeat(width)}\x1b[0m\n`;
            assert.strictEqual(getOutput(), expected);
        });

        test("uses configurable options.width for code block top and bottom borders", () => {
            const width = 50;
            const { renderer, getOutput } = createCaptureRenderer({ width });
            renderer.write("```js\nx\n```\n");

            const prefix = "┌── Code (js) ";
            const topRemaining = width - prefix.length;
            const expectedTop = `\x1b[33m${prefix}${"─".repeat(topRemaining)}\x1b[0m\n`;
            const expectedBottom = `\n\x1b[33m└${"─".repeat(width - 1)}\x1b[0m\n`;

            assert.ok(getOutput().includes(expectedTop));
            assert.ok(getOutput().includes(expectedBottom));
        });

        test("getWidth defaults cleanly when width is not provided", () => {
            const renderer = new MarkdownStreamRenderer();
            const width = renderer.getWidth();
            assert.ok(typeof width === "number" && width >= 40 && width <= 80);
        });
    });

    describe("restoreStyle() & Chunk-Boundary Styling", () => {
        test("restores agent_thought_chunk grey color (\x1b[90m)", () => {
            const { renderer, getOutput } = createCaptureRenderer();
            renderer.setUpdateType("agent_thought_chunk");
            assert.strictEqual(getOutput(), "\x1b[90m");
        });

        test("restores default style (\x1b[0m) for normal message chunks", () => {
            const { renderer, getOutput } = createCaptureRenderer();
            renderer.setUpdateType("agent_message_chunk");
            assert.strictEqual(getOutput(), "\x1b[0m");
        });

        test("restoreStyle accurately restores all active styles (header, blockquote, code, bold, italic)", () => {
            const { renderer, getOutput, clearOutput } = createCaptureRenderer();
            renderer.setUpdateType("agent_thought_chunk");
            renderer.inHeader = 2; // \x1b[1;36m
            renderer.inBlockquote = true; // \x1b[3m
            renderer.inCodeBlock = true; // \x1b[33m
            renderer.inBold = true; // \x1b[1m
            renderer.inItalic = true; // \x1b[3m

            clearOutput();
            renderer.restoreStyle();

            // Order: base (\x1b[90m), header (\x1b[1;36m), blockquote (\x1b[3m), code (\x1b[33m), bold (\x1b[1m), italic (\x1b[3m)
            const expected = "\x1b[90m\x1b[1;36m\x1b[3m\x1b[33m\x1b[1m\x1b[3m";
            assert.strictEqual(getOutput(), expected);
        });

        test("does not reset active bold style across chunk boundaries", () => {
            const { renderer, getOutput } = createCaptureRenderer();
            renderer.write("This is **bold ");
            renderer.write("across chunks** normal");
            renderer.flush();

            const out = getOutput();
            // Should contain bold start \x1b[1m
            assert.ok(out.includes("\x1b[1m"));
            // Should not have unconditional reset \x1b[0m before "across chunks"
            assert.ok(!out.includes("\x1b[0macross chunks"));
            assert.ok(out.includes("bold across chunks"));
        });

        test("retains agent_thought_chunk base color when bold ends across chunks", () => {
            const { renderer, getOutput } = createCaptureRenderer();
            renderer.setUpdateType("agent_thought_chunk");
            renderer.write("Thinking **bold ");
            renderer.write("phrase** more thoughts");
            renderer.flush();

            const out = getOutput();
            // When bold closes, \x1b[0m is emitted followed by restoreStyle() which emits \x1b[90m
            assert.ok(out.includes("\x1b[0m\x1b[90m more thoughts"));
        });
    });

    describe("Headers and Blockquotes", () => {
        test("header prefixes format with distinct colors and symbols", () => {
            const cases = [
                { text: "# Header 1\n", prefix: "\x1b[1;35m█ " },
                { text: "## Header 2\n", prefix: "\x1b[1;36m■ " },
                { text: "### Header 3\n", prefix: "\x1b[1;33m▲ " },
                { text: "#### Header 4\n", prefix: "\x1b[1;32m○ " },
                { text: "###### Header 6\n", prefix: "\x1b[1;32m○ " }
            ];

            for (const { text, prefix } of cases) {
                const { renderer, getOutput } = createCaptureRenderer();
                renderer.write(text);
                assert.ok(getOutput().includes(prefix), `Expected ${text} to output prefix ${prefix}`);
            }
        });

        test("header reset on newline writes \x1b[0m AND calls restoreStyle()", () => {
            const { renderer, getOutput } = createCaptureRenderer();
            renderer.setUpdateType("agent_thought_chunk");
            renderer.write("# Section Title\nNext thought line\n");

            const out = getOutput();
            // Closing header on newline emits \x1b[0m\x1b[90m\n
            assert.ok(out.includes("\x1b[0m\x1b[90m\nNext thought line"));
        });

        test("single blockquote renders vertical bar and italic", () => {
            const { renderer, getOutput } = createCaptureRenderer();
            renderer.write("> A famous quote\n");
            const out = getOutput();
            assert.ok(out.includes("\x1b[90m│ \x1b[3mA famous quote"));
        });

        test("nested blockquotes render multiple bars", () => {
            const { renderer, getOutput } = createCaptureRenderer();
            renderer.write(">> Nested quote\n");
            const out = getOutput();
            assert.ok(out.includes("\x1b[90m│ \x1b[90m│ \x1b[3mNested quote"));
        });

        test("blockquote reset on newline restores agent_thought_chunk color", () => {
            const { renderer, getOutput } = createCaptureRenderer();
            renderer.setUpdateType("agent_thought_chunk");
            renderer.write("> Quoted thought\nSubsequent thought\n");

            const out = getOutput();
            assert.ok(out.includes("\x1b[0m\x1b[90m\nSubsequent thought"));
        });
    });

    describe("Code Blocks & Empty Lines", () => {
        test("empty lines inside code blocks emit left border │ before newline", () => {
            const { renderer, getOutput } = createCaptureRenderer({ width: 50 });
            renderer.write("```\nline 1\n\nline 2\n```\n");

            const out = getOutput();
            // Verify that the empty line between line 1 and line 2 contains the border prefix
            assert.ok(out.includes("\x1b[33m│ \x1b[0m\x1b[0m\x1b[33m\n"));
            assert.ok(out.includes("line 1"));
            assert.ok(out.includes("line 2"));
        });

        test("consecutive empty lines inside code blocks all receive borders", () => {
            const { renderer, getOutput } = createCaptureRenderer({ width: 50 });
            renderer.write("```\nline 1\n\n\nline 2\n```\n");

            const out = getOutput();
            const blankLineBorder = "\x1b[33m│ \x1b[0m\x1b[0m\x1b[33m\n";
            const firstIdx = out.indexOf(blankLineBorder);
            assert.ok(firstIdx !== -1, "First blank line must have border");
            const secondIdx = out.indexOf(blankLineBorder, firstIdx + blankLineBorder.length);
            assert.ok(secondIdx !== -1, "Second consecutive blank line must have border");
        });

        test("code block with 3 backticks opens and closes cleanly", () => {
            const { renderer, getOutput } = createCaptureRenderer({ width: 50 });
            renderer.write("```js\nconst x = 1;\n```\n");

            const out = getOutput();
            assert.ok(out.includes("┌── Code (js)"));
            assert.ok(out.includes("const x = 1;"));
            assert.ok(out.includes("└─"));
        });

        test("supports code fences of 4 backticks and ignores 3 backticks inside", () => {
            const { renderer, getOutput } = createCaptureRenderer({ width: 50 });
            renderer.write("````markdown\n```\ninner\n```\n````\n");

            const out = getOutput();
            assert.ok(out.includes("┌── Code (markdown)"));
            // The inner 3 backticks at line start should be emitted as code text, not close the block!
            assert.ok(out.includes("```\n"));
            assert.ok(out.includes("inner\n"));
            // The 4 backticks close the block
            assert.ok(out.includes("└─"));
        });

        test("backticks in the middle of a line inside code block do not close it", () => {
            const { renderer, getOutput } = createCaptureRenderer({ width: 50 });
            renderer.write("```js\nconst s = `hello`;\n```\n");

            const out = getOutput();
            assert.ok(out.includes("const s = `hello`;"));
            assert.ok(out.includes("└─"));
        });
    });

    describe("flush() Ordering & Trailing Tokens", () => {
        test("flushes lineStartBuf before flushBackticks and flushAsterisks", () => {
            const { renderer, getOutput } = createCaptureRenderer();
            renderer.write("`test");
            renderer.flush();

            const out = getOutput();
            // ` opened inline code \x1b[33m, test, and flush closed with \x1b[0m
            assert.ok(out.includes("\x1b[33mtest\x1b[0m"));
        });

        test("flushes trailing unclosed bold at EOF", () => {
            const { renderer, getOutput } = createCaptureRenderer();
            renderer.write("**unclosed bold");
            renderer.flush();

            const out = getOutput();
            assert.ok(out.includes("\x1b[1munclosed bold\x1b[0m"));
        });

        test("flushes trailing unclosed code block at EOF with bottom border", () => {
            const { renderer, getOutput } = createCaptureRenderer({ width: 40 });
            renderer.write("```\npartial code");
            renderer.flush();

            const out = getOutput();
            assert.ok(out.includes("partial code"));
            assert.ok(out.includes("└─"));
        });

        test("flushes horizontal rule if buffer contains HR at flush()", () => {
            const { renderer, getOutput } = createCaptureRenderer({ width: 40 });
            renderer.write("---");
            renderer.flush();

            const out = getOutput();
            assert.ok(out.includes("────"));
        });
    });

    describe("Line Start Buffering Latency & False Buffering", () => {
        test("flushes immediately on non-prefix text like '2026 is' without delay", () => {
            const { renderer, getOutput } = createCaptureRenderer();
            renderer.write("2026 is a great year");
            renderer.flush();

            assert.strictEqual(getOutput(), "2026 is a great year");
        });

        test("flushes '2026 ' immediately when space has no dot", () => {
            const { renderer, getOutput } = createCaptureRenderer();
            renderer.write("2026 ");
            assert.strictEqual(getOutput(), "2026 ");
        });

        test("recognizes valid numbered list '1. item'", () => {
            const { renderer, getOutput } = createCaptureRenderer();
            renderer.write("1. First item\n");

            const out = getOutput();
            assert.ok(out.includes("\x1b[36m1.\x1b[0m"));
            assert.ok(out.includes("First item"));
        });

        test("recognizes bullet list '- item' and '* item'", () => {
            const { renderer: r1, getOutput: out1 } = createCaptureRenderer();
            r1.write("- dash bullet\n");
            assert.ok(out1().includes("\x1b[32m•\x1b[0m"));
            assert.ok(out1().includes("dash bullet"));

            const { renderer: r2, getOutput: out2 } = createCaptureRenderer();
            r2.write("* star bullet\n");
            assert.ok(out2().includes("\x1b[32m•\x1b[0m"));
            assert.ok(out2().includes("star bullet"));
        });

        test("ignores Windows carriage return (\\r) cleanly", () => {
            const { renderer, getOutput } = createCaptureRenderer();
            renderer.write("# Windows Header\r\nLine 2\r\n");

            const out = getOutput();
            assert.ok(!out.includes("\r"));
            assert.ok(out.includes("Windows Header"));
            assert.ok(out.includes("Line 2"));
        });
    });

    describe("Horizontal Rules & isHorizontalRule()", () => {
        test("isHorizontalRule requires at least 3 markers", () => {
            const renderer = new MarkdownStreamRenderer();
            assert.strictEqual(renderer.isHorizontalRule("---"), true);
            assert.strictEqual(renderer.isHorizontalRule("----"), true);
            assert.strictEqual(renderer.isHorizontalRule("- - -"), true);
            assert.strictEqual(renderer.isHorizontalRule("***"), true);
            assert.strictEqual(renderer.isHorizontalRule("* * *"), true);
            assert.strictEqual(renderer.isHorizontalRule("___"), true);
            assert.strictEqual(renderer.isHorizontalRule("_ _ _"), true);
            assert.strictEqual(renderer.isHorizontalRule("   ---   "), true);
        });

        test("isHorizontalRule rejects fewer than 3 markers or mixed markers", () => {
            const renderer = new MarkdownStreamRenderer();
            assert.strictEqual(renderer.isHorizontalRule("--"), false);
            assert.strictEqual(renderer.isHorizontalRule("- - "), false);
            assert.strictEqual(renderer.isHorizontalRule("**"), false);
            assert.strictEqual(renderer.isHorizontalRule("__"), false);
            assert.strictEqual(renderer.isHorizontalRule("-*-"), false);
            assert.strictEqual(renderer.isHorizontalRule("---abc"), false);
            assert.strictEqual(renderer.isHorizontalRule(""), false);
            assert.strictEqual(renderer.isHorizontalRule(null), false);
            assert.strictEqual(renderer.isHorizontalRule(undefined), false);
        });

        test("emits horizontal rule on newline", () => {
            const { renderer, getOutput } = createCaptureRenderer({ width: 50 });
            renderer.write("___\nNext paragraph\n");

            const out = getOutput();
            assert.ok(out.includes(`\x1b[90m${"─".repeat(50)}\x1b[0m`));
            assert.ok(out.includes("Next paragraph"));
        });
    });

    describe("Triple Asterisks (***)", () => {
        test("toggles bold and italic together", () => {
            const { renderer, getOutput } = createCaptureRenderer();
            renderer.write("***bold and italic*** normal");
            renderer.flush();

            const out = getOutput();
            assert.ok(out.includes("\x1b[1m\x1b[3mbold and italic\x1b[0m"));
            assert.ok(out.includes("normal"));
        });

        test("retains thought chunk grey color when *** closes", () => {
            const { renderer, getOutput } = createCaptureRenderer();
            renderer.setUpdateType("agent_thought_chunk");
            renderer.write("***important thought*** continuation");
            renderer.flush();

            const out = getOutput();
            assert.ok(out.includes("\x1b[0m\x1b[90m continuation"));
        });
    });

    describe("Inline Code & Formatting", () => {
        test("inline code formatted with yellow style \x1b[33m", () => {
            const { renderer, getOutput } = createCaptureRenderer();
            renderer.write("Use `npm test` to run tests");
            renderer.flush();

            const out = getOutput();
            assert.ok(out.includes("\x1b[33mnpm test\x1b[0m"));
        });

        test("single asterisk italic formatted with \x1b[3m and reset with \x1b[23m", () => {
            const { renderer, getOutput } = createCaptureRenderer();
            renderer.write("An *italic* word");
            renderer.flush();

            const out = getOutput();
            assert.ok(out.includes("\x1b[3mitalic\x1b[23m"));
        });

        test("streaming character by character produces correct output", () => {
            const { renderer, getOutput } = createCaptureRenderer({ width: 40 });
            const input = "# Test\n\n`code` and **bold**\n";
            for (const char of input) {
                renderer.write(char);
            }
            renderer.flush();

            const out = getOutput();
            assert.ok(out.includes("\x1b[1;35m█ "));
            assert.ok(out.includes("\x1b[33mcode\x1b[0m"));
            assert.ok(out.includes("\x1b[1mbold\x1b[0m"));
        });
    });

    describe("Individual restoreStyle() Scenarios", () => {
        test("restores header level 1 style", () => {
            const { renderer, getOutput, clearOutput } = createCaptureRenderer();
            renderer.inHeader = 1;
            clearOutput();
            renderer.restoreStyle();
            assert.strictEqual(getOutput(), "\x1b[0m\x1b[1;35m");
        });

        test("restores header level 2 style", () => {
            const { renderer, getOutput, clearOutput } = createCaptureRenderer();
            renderer.inHeader = 2;
            clearOutput();
            renderer.restoreStyle();
            assert.strictEqual(getOutput(), "\x1b[0m\x1b[1;36m");
        });

        test("restores header level 3 style", () => {
            const { renderer, getOutput, clearOutput } = createCaptureRenderer();
            renderer.inHeader = 3;
            clearOutput();
            renderer.restoreStyle();
            assert.strictEqual(getOutput(), "\x1b[0m\x1b[1;33m");
        });

        test("restores header level 4+ style", () => {
            const { renderer, getOutput, clearOutput } = createCaptureRenderer();
            renderer.inHeader = 4;
            clearOutput();
            renderer.restoreStyle();
            assert.strictEqual(getOutput(), "\x1b[0m\x1b[1;32m");

            clearOutput();
            renderer.inHeader = 6;
            renderer.restoreStyle();
            assert.strictEqual(getOutput(), "\x1b[0m\x1b[1;32m");
        });

        test("restores blockquote style", () => {
            const { renderer, getOutput, clearOutput } = createCaptureRenderer();
            renderer.inBlockquote = true;
            clearOutput();
            renderer.restoreStyle();
            assert.strictEqual(getOutput(), "\x1b[0m\x1b[3m");
        });

        test("restores code block style", () => {
            const { renderer, getOutput, clearOutput } = createCaptureRenderer();
            renderer.inCodeBlock = true;
            clearOutput();
            renderer.restoreStyle();
            assert.strictEqual(getOutput(), "\x1b[0m\x1b[33m");
        });

        test("restores inline code style", () => {
            const { renderer, getOutput, clearOutput } = createCaptureRenderer();
            renderer.inInlineCode = true;
            clearOutput();
            renderer.restoreStyle();
            assert.strictEqual(getOutput(), "\x1b[0m\x1b[33m");
        });

        test("restores bold style", () => {
            const { renderer, getOutput, clearOutput } = createCaptureRenderer();
            renderer.inBold = true;
            clearOutput();
            renderer.restoreStyle();
            assert.strictEqual(getOutput(), "\x1b[0m\x1b[1m");
        });

        test("restores italic style", () => {
            const { renderer, getOutput, clearOutput } = createCaptureRenderer();
            renderer.inItalic = true;
            clearOutput();
            renderer.restoreStyle();
            assert.strictEqual(getOutput(), "\x1b[0m\x1b[3m");
        });
    });

    describe("Indented Lists & Complex Code Fences", () => {
        test("handles indented bullet list", () => {
            const { renderer, getOutput } = createCaptureRenderer();
            renderer.write("  - indented item\n");
            const out = getOutput();
            assert.ok(out.includes("  \x1b[32m•\x1b[0m"));
            assert.ok(out.includes("indented item"));
        });

        test("handles indented numbered list", () => {
            const { renderer, getOutput } = createCaptureRenderer();
            renderer.write("   2. indented item\n");
            const out = getOutput();
            assert.ok(out.includes("   \x1b[36m2.\x1b[0m"));
            assert.ok(out.includes("indented item"));
        });

        test("trims language identifier in code block", () => {
            const { renderer, getOutput } = createCaptureRenderer({ width: 50 });
            renderer.write("```   python   \nprint(1)\n```\n");
            const out = getOutput();
            assert.ok(out.includes("┌── Code (python)"));
        });

        test("handles 5 backticks fence requiring 5 backticks to close", () => {
            const { renderer, getOutput } = createCaptureRenderer({ width: 50 });
            renderer.write("`````\n````\ninner 4 backticks\n````\n`````\n");
            const out = getOutput();
            assert.ok(out.includes("inner 4 backticks"));
            assert.ok(out.includes("└─"));
        });
    });

    describe("ACP Client Repl Simulation", () => {
        test("transitions smoothly from thought chunk to message chunk", () => {
            const { renderer, getOutput } = createCaptureRenderer({ width: 50 });

            // 1. Thought chunk
            renderer.setUpdateType("agent_thought_chunk");
            renderer.write("I should **check** the file:\n```js\nconst x = 10;\n```\nDone thinking.\n");
            renderer.flush();

            // 2. Message chunk
            renderer.reset();
            renderer.setUpdateType("agent_message_chunk");
            renderer.write("Here is the answer:\n- Item A\n- Item B\n");
            renderer.flush();

            const out = getOutput();
            assert.ok(out.includes("\x1b[90m")); // Thought gray
            assert.ok(out.includes("┌── Code (js)"));
            assert.ok(out.includes("const x = 10;"));
            assert.ok(out.includes("Item A"));
            assert.ok(out.includes("Item B"));
        });
    });
});
