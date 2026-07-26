export function escapeTerminalControlCharacters(value: string): string {
  let escaped = "";
  for (const character of value) {
    if (character === "\r") {
      escaped += "\\r";
      continue;
    }
    if (character === "\n") {
      escaped += "\\n";
      continue;
    }
    if (character === "\t") {
      escaped += "\\t";
      continue;
    }
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) {
      escaped += `\\u${codePoint.toString(16).padStart(4, "0")}`;
      continue;
    }
    escaped += character;
  }
  return escaped;
}
