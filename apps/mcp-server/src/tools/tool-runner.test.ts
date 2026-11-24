import { DomainError, ReauthRequired } from '@jarvis/core';
import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ToolRunner } from './tool-runner';

describe('ToolRunner', () => {
  it('on ReauthRequired it drops the account bundle (so a re-authorized token is picked up) and returns the message', async () => {
    const registry = { invalidate: vi.fn() };
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const runner = new ToolRunner(registry);
    const result = await runner.run('search_emails', async () => {
      throw new ReauthRequired('personal');
    });
    expect(registry.invalidate).toHaveBeenCalledWith('personal');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"accountId":"personal"'));
    warn.mockRestore();
    expect(result).toEqual({ isError: true, content: [{ type: 'text', text: 'Account personal needs re-authorization' }] });
  });

  it('does not touch the registry for other domain errors', async () => {
    const registry = { invalidate: vi.fn() };
    const result = await new ToolRunner(registry).run('t', async () => {
      throw new DomainError('nope');
    });
    expect(registry.invalidate).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
  });
});
