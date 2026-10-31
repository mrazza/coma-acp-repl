import { ANSI } from "./ansi.js";

/**
 * Activity spinner for asynchronous wait states (thinking, tool execution).
 */
export class ActivitySpinner {
    constructor() {
        this.frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
        this.interval = null;
        this.frameIndex = 0;
        this.currentText = "Thinking...";
        this.isActive = false;
    }

    start(text = "Thinking...") {
        this.currentText = text;
        if (this.isActive) return;
        this.isActive = true;
        this.frameIndex = 0;

        if (process.stdout.isTTY) {
            this.interval = setInterval(() => {
                const frame = this.frames[this.frameIndex++ % this.frames.length];
                process.stdout.write(`\r${ANSI.dim}${frame} ${this.currentText}${ANSI.reset}${ANSI.clearLine}`);
            }, 80);
        }
    }

    update(text) {
        this.currentText = text;
    }

    stop() {
        if (!this.isActive) return;
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
        this.isActive = false;
        if (process.stdout.isTTY) {
            process.stdout.write(`\r${ANSI.clearLine}`);
        }
    }
}
