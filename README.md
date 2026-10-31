# ACP Interactive Client & REPL for Coma

A Node.js implementation of a CLI/REPL client that interacts with the **Coma** agent via the **Agent Client Protocol (ACP)**. It provides a real-time interactive terminal environment with full markdown-rendered streaming output, tool execution tracking, interactive permission negotiation, file mention expansion, and session export capabilities.

## Features

- **Agent Client Protocol (ACP)**: Fully implements protocol handshake negotiation, session initialization, and prompt execution using `@agentclientprotocol/sdk`.
- **Interactive REPL**: Modern async CLI loop (`readline/promises`) supporting single-line and multiline inputs.
- **Activity Spinner**: Non-intrusive terminal spinner (`⠋ Thinking...`, `⠋ Running <tool>...`) during inference and tool execution that cleanly clears when output streams.
- **Graceful Turn Cancellation (`Ctrl+C`)**: Pressing `Ctrl+C` while the agent is generating cancels the active prompt turn via protocol cancellation (`session/cancel`) and returns immediately to the prompt without terminating the REPL session. Pressing `Ctrl+C` at an idle prompt cleanly exits.
- **Multiline Input**: Append a trailing backslash (`\`) at the end of a line to continue entering prompts across multiple lines (`... ` continuation prompt).
- **`@file` Context Mentions**: Reference files using `@path/to/file` in prompts; the client automatically resolves existing files relative to the session working directory and embeds their content into the ACP request blocks.
- **Tool Execution Tracking**:
  - Live notifications when tools start (`🔧 [Tool Call: <name> -> in_progress]`) with formatted/dimmed arguments.
  - Completion status badges (`✓` green for success, `✗` red for failure).
  - Output display preview (truncated to 10 lines by default; full output in verbose mode).
- **Interactive Permission Handling**: When tools request user permission, presents an interactive menu with numbered options, defaulting to allow on `Enter` and cancelling on `n`.
- **Session Slash Commands**: In-REPL commands for clearing the screen, starting fresh sessions, inspecting executed tools, toggling verbose output, and exporting Markdown transcripts.
- **Rich Terminal Markdown Stream Renderer**: Dynamically parses and styles streamed markdown content as it arrives (headers, bullet lists, code blocks with borders, inline code, bold, italics).

---

## Installation & Setup

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher recommended, module support enabled)
- The **Coma** agent executable compiled and located at `../coma/zig-out/bin/coma` (or configure a custom path).

### Install Dependencies

```bash
npm install
```

---

## CLI Usage

Start the REPL client:

```bash
node test_client.js [options]
```

Or run via npm:

```bash
npm start
```

### CLI Arguments & Options

| Option | Environment Variable | Default | Description |
|---|---|---|---|
| `--bin <path>` | `COMA_BIN` | `../coma/zig-out/bin/coma` (or `coma` in `PATH`) | Path to the `coma` agent executable. |
| `--cwd <dir>` | `COMA_CWD` | `process.cwd()` | Working directory for the ACP session. |
| `--add-dir <dir>` | — | — | Additional directory scope (can be repeated multiple times). |
| `-v`, `--verbose` | — | `false` | Enable verbose mode (shows full tool outputs and thoughts by default). |
| `-h`, `--help` | — | — | Display CLI usage summary and exit. |

#### Examples

```bash
# Run with a custom binary path and working directory
node test_client.js --bin /path/to/coma --cwd /path/to/project

# Allow additional directories and enable verbose output
node test_client.js --add-dir ../shared --add-dir ../docs --verbose
```

---

## REPL Features & Usage

### 1. Multiline Input

To enter multi-line prompts or code snippets, terminate lines with a backslash `\`:

```text
❯ User: Review this function: \
... function add(a, b) { \
...   return a + b; \
... }
```

### 2. `@file` Mentions

Mention any local file using `@` followed by the relative or absolute path. If the file exists, the client reads its content and attaches it as additional context to the prompt sent to the agent:

```text
❯ User: Analyze the dependencies in @package.json and explain @src/index.js
[Attached context from: package.json, src/index.js]
```

### 3. Interactive Permission Handling

When the Coma agent requests user permission to run a tool, the client displays the tool information and prompts interactively:

```text
⚠️  [Permission Requested]
Tool: bash
Args: $ rm -rf /tmp/test
Options:
  [1] Allow Once (Default: Enter)
  [2] Allow Always
  [3] Reject
Select option [1-3] or 'n' to cancel:
```

- Press **Enter** to choose the default allow option.
- Enter **1** or **2** to pick a specific option.
- Enter **n** or **cancel** to reject permission.

### 4. REPL Slash Commands

Type slash commands directly at the `❯ User:` prompt:

| Command | Description |
|---|---|
| `/help` | Show available REPL slash commands and keyboard shortcuts. |
| `/new` | Start a fresh ACP session with the agent and reset conversation history. |
| `/cwd [dir]` | View current session working directory, or switch directory and start a new session. |
| `/verbose` | Toggle verbose mode on/off (compact vs. full tool outputs). |
| `/thoughts` | Toggle visibility of agent thinking chunks (`Thinking...`). |
| `/tools` | List all tool calls executed during the current session with inputs and outputs. |
| `/export [path]` | Export conversation history (prompts, thoughts, tools, agent answers) to Markdown. |
| `/clear` | Clear the terminal screen and reprint the header. |
| `/exit`, `/quit`, `exit` | Cleanly terminate the session and exit. |

### 5. Graceful Cancellation (`Ctrl+C`)

- **During Generation**: Pressing `Ctrl+C` while the agent is streaming thoughts, responses, or executing tools sends an ACP cancellation request (`session/cancel`), stops execution, and returns to the prompt.
- **When Idle**: Pressing `Ctrl+C` at an empty `❯ User:` prompt cleanly terminates the client and child process.

---

## Running Tests

Run the test suite using Node's built-in test runner:

```bash
npm test
```

Or run the client test suite directly:

```bash
node --test test_client.test.js
```

---

## License

This project is licensed under the Apache License 2.0. See the [LICENSE](LICENSE) file for details.
