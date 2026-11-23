import type { EmailAddress, PersonLinkLookup } from '@jarvis/core';

/** Phase 1 has no project/people data: nobody is linked to a project. */
export class NullPersonLinkLookup implements PersonLinkLookup {
  async isLinkedToAnyProject(_email: EmailAddress): Promise<boolean> {
    return false;
  }
}
