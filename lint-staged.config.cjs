function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

module.exports = {
  "**/*": (files) => [
    `bun biome check --write --unsafe --reporter concise --no-errors-on-unmatched ${files
      .map(shellQuote)
      .join(" ")}`,
    "bun run test:changed",
  ],
};
