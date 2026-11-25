import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { saveAgentToken, skipAgent, verifyAgent } from '@/api/client';
import { queryKeys, useProviders, useSetupStatus } from '@/api/hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { messageOf, tokenProblem } from './agent-token';

export function AgentStep() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const providers = useProviders('agent');
  const setup = useSetupStatus();
  const [token, setToken] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const kind = providers.data?.[0]?.kind ?? 'claude';

  const verify = useMutation({
    mutationFn: async (value: string) => {
      await saveAgentToken(kind, value);
      return verifyAgent(kind);
    },
    // The token is cleared as soon as it is sent; it is never shown again.
    onMutate: () => setToken(''),
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.setup }),
  });
  const skip = useMutation({
    mutationFn: skipAgent,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: queryKeys.setup });
      navigate('/onboarding/preferences');
    },
  });

  function submit() {
    const value = token.trim();
    setFormError(null);
    const problem = tokenProblem(value);
    if (problem) return setFormError(problem);
    verify.mutate(value);
  }

  const result = verify.data;
  const error = formError ?? (verify.isError ? messageOf(verify.error) : null) ?? (skip.isError ? messageOf(skip.error) : null) ?? (result && !result.ok ? `Verification failed: ${result.reason ?? 'unknown reason'}` : null);

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">AI agent</h2>
      <div className="space-y-1">
        <label htmlFor="agent-provider" className="text-sm font-medium">
          Provider
        </label>
        <select id="agent-provider" className="h-9 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm" defaultValue={kind}>
          {(providers.data ?? [{ kind: 'claude', label: 'Claude (subscription)' }]).map((p) => (
            <option key={p.kind} value={p.kind}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-neutral-700">
        <li>Install Claude Code on your computer.</li>
        <li>
          Run <code className="rounded bg-neutral-100 px-1">claude setup-token</code> and sign in with your subscription.
        </li>
        <li>Paste the token it prints below. Never paste an API key.</li>
      </ol>
      {setup.data && setup.data.agent !== 'none' && <p className="text-sm text-neutral-500">Current status: {setup.data.agent}.</p>}
      <div className="space-y-1">
        <label htmlFor="agent-token" className="text-sm font-medium">
          Claude token
        </label>
        <Input id="agent-token" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} />
      </div>
      {verify.isPending && <p className="text-sm text-neutral-500">Verifying…</p>}
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
      <div className="flex items-center gap-3">
        <Button onClick={submit} disabled={verify.isPending}>
          Verify
        </Button>
        {result?.ok ? (
          <Button asChild>
            <Link to="/onboarding/preferences">Continue</Link>
          </Button>
        ) : (
          <Button variant="outline" onClick={() => skip.mutate()} disabled={skip.isPending}>
            Skip for now
          </Button>
        )}
      </div>
    </section>
  );
}
