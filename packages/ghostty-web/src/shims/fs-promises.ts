function unavailable(): never {
  throw new Error(
    "Filesystem access is unavailable in the TUIL browser runtime",
  );
}

export const access = async (..._arguments: readonly unknown[]) =>
  unavailable();
export const lstat = async (..._arguments: readonly unknown[]) => unavailable();
export const mkdir = async (..._arguments: readonly unknown[]) => unavailable();
export const readFile = async (..._arguments: readonly unknown[]) =>
  unavailable();
export const realpath = async (..._arguments: readonly unknown[]) =>
  unavailable();
export const rename = async (..._arguments: readonly unknown[]) =>
  unavailable();
export const rm = async (..._arguments: readonly unknown[]) => unavailable();
export const stat = async (..._arguments: readonly unknown[]) => unavailable();
export const writeFile = async (..._arguments: readonly unknown[]) =>
  unavailable();

export default {
  access,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
};
