# ACP Test Client for Coma

A Node.js implementation of a CLI/REPL client that interacts with the **Coma** agent via the **Agent Client Protocol (ACP)**. It provides a real-time interactive terminal environment with full markdown-rendered streaming output, command logs, tool execution updates, and permission request handling.

## Features

- **Agent Client Protocol (ACP)**: Fully implements connection establishment, protocol handshake negotiation, session creation, and prompt execution using the `@agentclientprotocol/sdk`.
- **Interactive REPL**: A CLI loop that lets you prompt the Coma agent and receive streaming thoughts and messages.
- **Rich Terminal Markdown Renderer**: Dynamically parses and styles streamed markdown content as it arrives.
  - Custom visual decorations for headers (`█`, `■`, `▲`, `○`).
  - Styled list bullet points and numbers.
  - Blockquotes, bold, italics, inline code.
  - Border-boxed code blocks with syntax language identifiers.
  - Real-time text wrapping and line-oriented rendering.
- **Process Spawning**: Automatically spawns the Coma agent (`coma` executable in `--acp` mode) from parent or adjacent folders.
- **Tool Execution Tracking**: Visual representations for when the agent triggers tool calls and receives tool call updates.

## Project Structure

- `test_client.js`: Core entry point that manages the lifecycle of the Coma child process, ACP ndjson connection streams, initialization, and the REPL.
- `markdown_renderer.js`: Custom terminal-based streamed Markdown parser and ANSI text styler.

## Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher recommended, module support enabled)
- The **Coma** agent executable compiled and located at `../coma/zig-out/bin/coma` (or configure the path in `test_client.js`).

## Installation

1. Clone or copy this repository.
2. Install the package dependencies:
   ```bash
   npm install
   ```

## Usage

Start the client by running:
```bash
node test_client.js
```

### REPL Commands

- Enter any message to prompt the agent.
- Type `exit` to cleanly terminate the ACP session and exit the process.

## License

This project is licensed under the Apache License 2.0. See the [LICENSE](LICENSE) file for details.
