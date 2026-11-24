import { InvalidClientSecret, type GoogleClientSecretStore } from '@jarvis/adapters-google';
import { DomainError } from '@jarvis/core';
import type { GoogleClientStore } from './tokens';

/** Exposes the uploaded-client store to the API, turning adapter validation errors into domain errors. */
export class GoogleClientUpload implements GoogleClientStore {
  constructor(private readonly secrets: Pick<GoogleClientSecretStore, 'status' | 'save'>) {}

  status(): Promise<'present' | 'missing'> {
    return this.secrets.status();
  }

  async save(json: string): Promise<void> {
    try {
      await this.secrets.save(json);
    } catch (error) {
      if (error instanceof InvalidClientSecret) throw new DomainError(error.message);
      throw error;
    }
  }
}
