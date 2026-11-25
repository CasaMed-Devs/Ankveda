/**
 * Plain-text cleanup for astrologer messages (Persona API replies, greetings, openers).
 * The app shows plain text, so emoji and markdown symbols (`**bold**`, `*italic*`, `# heading`,
 * bullets, back-ticks…) are removed while the words and paragraph breaks are kept.
 */

const EMOJI = /[\p{Extended_Pictographic}\p{Regional_Indicator}\u{1F3FB}-\u{1F3FF}‍︎️⃣]/gu;

export const cleanReply = (input: string): string =>
  input
    .replace(EMOJI, '')
    // Markdown links [text](url) → text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .split('\n')
    .map((line) =>
      line
        // Headings, quotes and list markers at the start of a line
        .replace(/^\s*(#{1,6}|>+|[-*•●▪◦]|\d{1,2}[.)])\s+/, '')
        // Emphasis / code markers anywhere
        .replace(/[*_`~#]+/g, '')
        // Long dashes read better as a comma in chat
        .replace(/\s*[—–]\s*/g, ', ')
        .replace(/\s{2,}/g, ' ')
        .replace(/\s+([,.!?])/g, '$1')
        .replace(/^,\s*/, '')
        .trim(),
    )
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
