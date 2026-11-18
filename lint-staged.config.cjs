function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

module.exports = {
  "**/*.{js,cjs,mjs,jsx,ts,cts,mts,tsx,css,scss,less,html,json,jsonc,yaml,yml,toml,md,mdx,graphql,gql}":
    (files) => `bun fmt ${files.map(shellQuote).join(" ")}`,
  "**/*.{js,cjs,mjs,jsx,ts,cts,mts,tsx}": (files) => [
    `oxlint ${files.map(shellQuote).join(" ")}`,
    "bun run test:unit",
  ],
};
