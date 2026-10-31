#!/usr/bin/env node
import path from "path";
import { fileURLToPath } from "url";
import { main } from "./src/index.js";

export * from "./src/index.js";

const isDirectRun = process.argv[1] && (
    process.argv[1] === fileURLToPath(import.meta.url) ||
    path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
);

if (isDirectRun) {
    main().catch((err) => {
        console.error("Test failed with error:", err);
        process.exit(1);
    });
}
