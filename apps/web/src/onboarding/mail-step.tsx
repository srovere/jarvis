import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiError, uploadGoogleClient } from '@/api/client';
import { useAccounts, useProviders, useSetupStatus, queryKeys } from '@/api/hooks';
import { Button } from '@/components/ui/button';
import { GoogleClientGuide } from './google-client-guide';

const connectUrl = (kind: string) => `/api/oauth/${encodeURIComponent(kind)}/start?returnTo=/onboarding`;

function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

function ClientUpload() {
  const qc = useQueryClient();
  const [dragging, setDragging] = useState(false);
  const upload = useMutation({
    mutationFn: async (file: File) => uploadGoogleClient(await readText(file)),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.setup }),
  });
  const pick = (file: File | undefined) => file && upload.mutate(file);

  return (
    <div className="space-y-2">
      <label
        htmlFor="google-client-file"
        className={`flex cursor-pointer flex-col items-center gap-1 rounded-md border-2 border-dashed p-6 text-sm ${dragging ? 'border-neutral-900 bg-neutral-50' : 'border-neutral-300'}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          pick(e.dataTransfer.files[0]);
        }}
      >
        <span>Drop the downloaded JSON file here or choose it</span>
        <input id="google-client-file" aria-label="OAuth client file" type="file" accept=".json,application/json" className="text-xs" onChange={(e) => pick(e.target.files?.[0])} />
      </label>
      {upload.isPending && <p className="text-sm text-neutral-500">Uploading…</p>}
      {upload.isError && (
        <p role="alert" className="text-sm text-red-700">
          {upload.error instanceof ApiError ? upload.error.message : 'Could not upload the file.'}
        </p>
      )}
    </div>
  );
}

export function MailStep() {
  const [params] = useSearchParams();
  const providers = useProviders('mail');
  const setup = useSetupStatus();
  const accounts = useAccounts();
  const [chosen, setChosen] = useState<string | null>(null);
  const kind = chosen ?? providers.data?.[0]?.kind ?? 'google';
  const error = params.get('error');
  const clientMissing = setup.data?.googleClient === 'missing';
  const active = (accounts.data ?? []).filter((a) => a.status !== 'disabled');

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Mail &amp; Calendar</h2>
      {error && (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}
      {params.get('connected') && !error && (
        <p role="status" className="rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-800">
          Account connected.
        </p>
      )}

      <div className="space-y-1">
        <label htmlFor="mail-provider" className="text-sm font-medium">
          Provider
        </label>
        <select
          id="mail-provider"
          className="h-9 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm"
          value={kind}
          onChange={(e) => setChosen(e.target.value)}
        >
          {(providers.data ?? [{ kind: 'google', label: 'Google' }]).map((p) => (
            <option key={p.kind} value={p.kind}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      {clientMissing && (
        <>
          <p className="text-sm text-neutral-700">
            Jarvis needs a Google OAuth client of your own. Follow these steps, then upload the file you download.
          </p>
          <GoogleClientGuide />
          <ClientUpload />
        </>
      )}

      {active.length > 0 && (
        <ul aria-label="Connected accounts" className="space-y-1 text-sm">
          {active.map((a) => (
            <li key={a.id}>
              <span>{a.email}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-3">
        {clientMissing ? (
          <Button disabled>Connect with Google</Button>
        ) : (
          <Button asChild variant={active.length > 0 ? 'outline' : 'default'}>
            <a href={connectUrl(kind)}>{active.length > 0 ? 'Add another account' : 'Connect with Google'}</a>
          </Button>
        )}
        {active.length > 0 && (
          <Button asChild>
            <Link to="/onboarding/agent">Continue</Link>
          </Button>
        )}
      </div>
    </section>
  );
}
