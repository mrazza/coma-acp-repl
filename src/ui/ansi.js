/**
 * Centralized ANSI escape sequences and styling helpers for terminal output.
 */
export const ANSI = {
    reset: "\x1b[0m",
    bold: "\x1b[1m",
    dim: "\x1b[90m",
    italic: "\x1b[3m",
    italicOff: "\x1b[23m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
    cyan: "\x1b[36m",
    boldRed: "\x1b[1;31m",
    boldGreen: "\x1b[1;32m",
    boldYellow: "\x1b[1;33m",
    boldBlue: "\x1b[1;34m",
    boldMagenta: "\x1b[1;35m",
    boldCyan: "\x1b[1;36m",
    clearLine: "\x1b[K",
    clearScreen: "\x1b[2J\x1b[0f"
};
