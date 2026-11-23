export class DomainError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = new.target.name;
  }
}
export class InvalidTimeRange extends DomainError {}
export class InvalidEmailAddress extends DomainError {}
export class ReauthRequired extends DomainError {
  constructor(public readonly accountId: string) {
    super(`Account ${accountId} needs re-authorization`);
  }
}
export class CursorExpired extends DomainError {}

export class ThreadNotFound extends DomainError {
  constructor(public readonly threadId: string) {
    super(`Thread not found: ${threadId}`);
  }
}
