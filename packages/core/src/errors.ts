/** Raised when evidence is established to be wrong (a definite failure). */
export class BankableError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "BankableError"; }
}
/** Raised when evidence is unavailable, truncated, or the two endpoints disagree. Never a green result. */
export class InconclusiveError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "InconclusiveError"; }
}
