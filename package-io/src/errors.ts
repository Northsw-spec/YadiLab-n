export class PackageIOError extends Error {
  readonly code: string;
  readonly path?: string;

  constructor(code: string, message: string, path?: string) {
    super(message);
    this.name = "PackageIOError";
    this.code = code;
    if (path !== undefined) this.path = path;
  }
}
