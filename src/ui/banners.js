import { ANSI } from "./ansi.js";

/**
 * Prints the main REPL header banner.
 */
export function printReplHeader() {
    console.log(`\n${ANSI.boldCyan}┌────────────────────────────────────────────────────────┐`);
    console.log("│           COMA INTERACTIVE ACP CLIENT (REPL)           │");
    console.log(`└────────────────────────────────────────────────────────┘${ANSI.reset}`);
    console.log(`${ANSI.dim}Instructions: Type prompt and press Enter. End line with \\ for multiline.${ANSI.reset}`);
    console.log(`${ANSI.dim}Mention @file to attach file context. Type /help for slash commands.${ANSI.reset}\n`);
}

/**
 * Prints the help menu for REPL slash commands and prompt syntax.
 */
export function printReplCommands() {
    console.log(`\n${ANSI.boldCyan}REPL Slash Commands:${ANSI.reset}`);
    console.log(`  ${ANSI.bold}/help${ANSI.reset}           List all REPL commands and features`);
    console.log(`  ${ANSI.bold}/new${ANSI.reset}            Start a fresh ACP session and clear history`);
    console.log(`  ${ANSI.bold}/cwd [dir]${ANSI.reset}      View current working directory or switch and restart session`);
    console.log(`  ${ANSI.bold}/verbose${ANSI.reset}        Toggle verbose mode (full tool inputs/outputs)`);
    console.log(`  ${ANSI.bold}/thoughts${ANSI.reset}       Toggle showing/hiding agent thought stream`);
    console.log(`  ${ANSI.bold}/tools${ANSI.reset}          List all tool calls executed in the current session`);
    console.log(`  ${ANSI.bold}/export [path]${ANSI.reset}  Export conversation history to a Markdown file`);
    console.log(`  ${ANSI.bold}/clear${ANSI.reset}          Clear the terminal screen and reprint header`);
    console.log(`  ${ANSI.bold}/exit${ANSI.reset}, ${ANSI.bold}/quit${ANSI.reset}     Exit the ACP client\n`);
    console.log(`${ANSI.boldCyan}Prompt Syntax:${ANSI.reset}`);
    console.log(`  ${ANSI.bold}Multiline${ANSI.reset}       End a line with \`\\\` to continue on the next line`);
    console.log(`  ${ANSI.bold}@file${ANSI.reset}           Include \`@path/to/file\` in prompt to embed file contents`);
    console.log(`  ${ANSI.bold}Ctrl+C${ANSI.reset}          Cancels current prompt turn when active; exits when idle\n`);
}

/**
 * Prints CLI usage information and options summary.
 */
export function printHelp() {
    console.log(`\n${ANSI.boldCyan}Coma ACP Interactive Client & REPL${ANSI.reset}\n
Usage:
  node test_client.js [options]

Options:
  --bin <path>        Path to coma binary (default: ../coma/zig-out/bin/coma or PATH)
  --cwd <dir>         Working directory for the session (default: current working directory)
  --add-dir <dir>     Additional directory scope (repeatable)
  -v, --verbose       Show full tool inputs/outputs and thoughts by default
  -h, --help          Show this help message and exit

Environment Variables:
  COMA_BIN            Path to coma executable
  COMA_CWD            Default working directory for ACP session

REPL Slash Commands:
  /help               Show available REPL slash commands
  /new                Start a fresh ACP session and reset state
  /cwd [dir]          Show or switch session working directory
  /verbose            Toggle verbose output mode
  /thoughts           Toggle agent thought stream visibility
  /tools              List all tool calls executed in this session
  /export [path]      Export conversation history to Markdown file
  /clear              Clear screen and redisplay header
  /exit, /quit        Exit the client
`);
}
