function unavailable(operation: string): never {
  throw new Error(`${operation} is unavailable in the TUIL browser runtime`);
}

export const readFileSync = () => unavailable("Filesystem access");
export const writeFileSync = () => unavailable("Filesystem access");
export const existsSync = () => false;
export default { existsSync, readFileSync, writeFileSync };
