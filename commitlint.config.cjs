module.exports = {
  defaultIgnores: process.env.COMMITLINT_PR_TITLE !== "true",
  extends: ["@commitlint/config-conventional"],
};
