import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { createDraft } from '@/api/data';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';

const GMAIL_DRAFTS = 'https://mail.google.com/mail/#drafts';
/** Only ever link to Gmail itself, whatever the API returned. */
const safeGmailUrl = (url: string | undefined) => (url?.startsWith('https://mail.google.com/') ? url : GMAIL_DRAFTS);

/** Reply as a Gmail draft. Jarvis never sends email: the user reviews the draft in Gmail. */
export function DraftDialog({ accountId, threadId, onClose }: { accountId: string; threadId: string; onClose: () => void }) {
  const [body, setBody] = useState('');
  const draft = useMutation({ mutationFn: () => createDraft({ threadId, accountId, body: body.trim() }) });

  return (
    <Dialog title="Reply as draft" onClose={onClose}>
      {draft.isSuccess ? (
        <div className="space-y-3 text-sm">
          <p>Draft saved. It has not been sent.</p>
          <a className="text-blue-700 underline" href={safeGmailUrl(draft.data?.gmailUrl)} target="_blank" rel="noreferrer">
            Open in Gmail
          </a>
        </div>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (body.trim()) draft.mutate();
          }}
        >
          <p className="text-sm text-neutral-600">This saves a draft in Gmail. It is not sent: you review it in Gmail.</p>
          <label className="block space-y-1 text-sm">
            <span>Message</span>
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} />
          </label>
          {draft.isError && (
            <p role="alert" className="text-sm text-red-700">
              {draft.error.message}
            </p>
          )}
          <Button type="submit" disabled={!body.trim() || draft.isPending}>
            Save draft
          </Button>
        </form>
      )}
    </Dialog>
  );
}
