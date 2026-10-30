/**
 * Error classes decide the vend outcome:
 * - StsRejectedError: the vendor definitely did not issue a token → FAILED.
 * - StsUnknownOutcomeError: a token may or may not exist → UNKNOWN, never retried automatically.
 * - StsUnavailableError: a read-only call (meter check) could not complete.
 * - StsConfigError: the adapter is not allowed to run with the given configuration.
 */
export class StsRejectedError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = 'StsRejectedError';
  }
}

export class StsMeterNotFoundError extends StsRejectedError {
  constructor(message = 'Meter not found', code?: string) {
    super(message, code);
    this.name = 'StsMeterNotFoundError';
  }
}

export class StsUnknownOutcomeError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = 'StsUnknownOutcomeError';
  }
}

export class StsUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StsUnavailableError';
  }
}

export class StsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StsConfigError';
  }
}
