import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { saveAgentToken, verifyAgent } from '@/api/client';
import { queryKeys, useProviders, useSetupStatus } from '@/api/hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { messageOf, tokenProblem } from '@/onboarding/agent-token';

type Verification = { ok: boolean; latencyMs?: number; reason?: string };

export function AgentSettings() {
  const qc = useQueryClient();
  const providers = useProviders('agent');
  const setup = useSetupStatus();
  const kind = providers.data?.[0]?.kind ?? 'claude';
  const [token, setToken] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const done = () => qc.invalidateQueries({ queryKey: queryKeys.setup });
  const replace = useMutation<Verification, unknown, string>({
    mutationFn: async (value) => {
      await saveAgentToken(kind, value);
      return verifyAgent(kind);
    },
    // The token is cleared as soon as it is sent; it is never shown again.
    onMutate: () => setToken(''),
    onSettled: done,
  });
  const verify = useMutation<Verification>({ mutationFn: () => verifyAgent(kind), onSettled: done });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = token.trim();
    const problem = tokenProblem(value);
    setFormError(problem);
    if (!problem) replace.mutate(value);
  }

  const last = verify.isPending || replace.isPending ? undefined : (verify.submittedAt > replace.submittedAt ? verify : replace);
  const result = last?.data;
  const error = formError ?? (last?.isError ? messageOf(last.error) : null) ?? (result && !result.ok ? `Verification failed: ${result.reason ?? 'unknown reason'}` : null);
  const status = setup.data?.agent;

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">AI agent</h2>
      <p className="text-sm">Status: {status ?? 'loading…'}</p>
      {(status === 'none' || status === 'skipped') && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium">Connect your AI agent</p>
          <p>
            Run <code className="rounded bg-white px-1">claude setup-token</code>, then paste the token below to enable the assistant.
          </p>
        </div>
      )}
      <form onSubmit={submit} className="space-y-2">
        <label htmlFor="agent-new-token" className="text-sm font-medium">
          New Claude token
        </label>
        <Input id="agent-new-token" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} />
        <div className="flex gap-3">
          <Button type="submit" disabled={replace.isPending}>
            Replace token
          </Button>
          <Button type="button" variant="outline" onClick={() => verify.mutate()} disabled={verify.isPending}>
            Verify
          </Button>
        </div>
      </form>
      {(replace.isPending || verify.isPending) && <p className="text-sm text-neutral-500">Verifying…</p>}
      {result?.ok && (
        <p role="status" className="text-sm text-green-800">
          Connected — {result.latencyMs ?? 0} ms
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </section>
  );
}
