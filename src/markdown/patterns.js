import { ANSI } from "../ui/ansi.js";

/**
 * ANSI style codes applied to headers of levels 1 through 4+
 */
export const HEADER_STYLES = {
    1: ANSI.boldMagenta,
    2: ANSI.boldCyan,
    3: ANSI.boldYellow,
    4: ANSI.boldGreen
};

/**
 * Decorative prefixes displayed at the beginning of headers
 */
export const HEADER_PREFIXES = {
    1: `${ANSI.boldMagenta}█ `,
    2: `${ANSI.boldCyan}■ `,
    3: `${ANSI.boldYellow}▲ `,
    4: `${ANSI.boldGreen}○ `
};

/**
 * Checks whether a candidate buffer could be the start of a markdown block prefix.
 * Used for line-start buffering to prevent premature flushing.
 */
export function isPlausibleLineStart(str) {
    if (!str || typeof str !== "string") return false;
    if (/^#{1,6} ?$/.test(str)) return true;
    if (/^ *(> *)+$/.test(str)) return true;
    if (/^ *[\-\*] ?$/.test(str)) return true;
    if (/^ *\d+(\. ?)?$/.test(str) && !/^ *\d+ $/.test(str)) return true;
    if (/^ *(\-+|\*+|\_+)[ \-\*\_]*$/.test(str)) return true;
    if (/^ *`{1,10}$/.test(str)) return true;
    if (/^ {1,4}$/.test(str)) return true;
    return false;
}

/**
 * Checks whether a line buffer matches a markdown horizontal rule (e.g. ---, ***, ___).
 */
export function isHorizontalRule(buf) {
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

/**
 * Matches a line start buffer against known markdown block prefixes:
 * headers, blockquotes, bullet lists, or numbered lists.
 *
 * @param {string} buf
 * @returns {{ type: 'header' | 'blockquote' | 'bullet' | 'numbered', level?: number, prefix: string, spaces?: string, num?: string } | null}
 */
export function matchBlockPrefix(buf) {
    if (!buf || typeof buf !== "string" || !buf.endsWith(" ")) {
        return null;
    }

    // 1. Headers: ^(#{1,6}) $
    const headerMatch = buf.match(/^(#{1,6}) $/);
    if (headerMatch) {
        const level = headerMatch[1].length;
        const prefix = HEADER_PREFIXES[level] || HEADER_PREFIXES[4];
        return {
            type: "header",
            level,
            prefix
        };
    }

    // 2. Blockquotes: ^( *)((?:> *)+)$
    const bqMatch = buf.match(/^( *)((?:> *)+)$/);
    if (bqMatch) {
        const spaces = bqMatch[1];
        const level = (bqMatch[2].match(/>/g) || []).length;
        const bars = `${ANSI.dim}│ `.repeat(level);
        return {
            type: "blockquote",
            level,
            spaces,
            prefix: `${spaces}${bars}${ANSI.italic}`
        };
    }

    // 3. Bullet lists: ^( *)[\-\*] $
    const bulletMatch = buf.match(/^( *)[\-\*] $/);
    if (bulletMatch) {
        const spaces = bulletMatch[1];
        return {
            type: "bullet",
            spaces,
            prefix: `${spaces}${ANSI.green}•${ANSI.reset} `
        };
    }

    // 4. Numbered lists: ^( *)(\d+)\. $
    const numMatch = buf.match(/^( *)(\d+)\. $/);
    if (numMatch) {
        const spaces = numMatch[1];
        const num = numMatch[2];
        return {
            type: "numbered",
            spaces,
            num,
            prefix: `${spaces}${ANSI.cyan}${num}.${ANSI.reset} `
        };
    }

    return null;
}
