export class WltReadError extends Error {
  readonly status: number;

  constructor(status: number) {
    super("WLT wallet read unavailable");
    this.name = "WltReadError";
    this.status = status;
  }
}
