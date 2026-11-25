const CONSOLE = 'https://console.cloud.google.com';

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/tasks',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
] as const;

function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a className="underline" href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

function Item({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="rounded-md border border-neutral-200 px-3 py-2">
      <summary className="cursor-pointer text-sm font-medium">{title}</summary>
      <div className="mt-2 space-y-2 text-sm text-neutral-700">{children}</div>
    </details>
  );
}

/** How to create the Google OAuth client the user then uploads. Each item opens the matching Cloud Console page. */
export function GoogleClientGuide() {
  return (
    <div className="space-y-2">
      <Item title="Create a Google Cloud project">
        <p>
          Open <ExtLink href={`${CONSOLE}/projectcreate`}>New project</ExtLink> and create a project (any name, for
          example “Jarvis”).
        </p>
      </Item>
      <Item title="Enable the Gmail, Calendar and Tasks APIs">
        <p>
          In the <ExtLink href={`${CONSOLE}/apis/library`}>API library</ExtLink>, enable the Gmail API, the Google
          Calendar API and the Google Tasks API for that project.
        </p>
      </Item>
      <Item title="Configure the consent screen (Google Auth platform)">
        <p>
          Open the <ExtLink href={`${CONSOLE}/auth/overview`}>Google Auth platform</ExtLink> (menu › Google Auth
          platform) for your project and click <strong>Get started</strong>:
        </p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>App information: any app name (for example “Jarvis”) and your email as user support email. Next.</li>
          <li>Audience: choose <strong>External</strong>. Next.</li>
          <li>Contact information: your email. Next.</li>
          <li>Accept the Google API Services User Data Policy, then Continue › Create.</li>
        </ol>
        <p>
          Then open <ExtLink href={`${CONSOLE}/auth/branding`}>Branding</ExtLink> and complete the “App domain”
          section, which Google requires:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Application home page</li>
          <li>Application privacy policy link</li>
          <li>Application terms of service link</li>
          <li>
            Under “Authorized domains”, <strong>Add domain</strong> with the domain of those pages (for example{' '}
            <code>yourname.github.io</code> if you host them on GitHub Pages).
          </li>
        </ul>
        <p>
          The pages must be public and on a domain you own; Google may ask you to verify it in{' '}
          <ExtLink href="https://search.google.com/search-console">Google Search Console</ExtLink>. Click{' '}
          <strong>Save</strong> at the bottom of Branding. The wizard does not ask for permissions; you add them in the
          next step.
        </p>
      </Item>
      <Item title="Add the five permissions (scopes)">
        <p>
          Open <ExtLink href={`${CONSOLE}/auth/scopes`}>Data access</ExtLink> and click{' '}
          <strong>Add or remove scopes</strong>. At the bottom of the panel, under “Manually add scopes”, paste these
          five lines, click <strong>Add to table</strong>, then <strong>Update</strong>:
        </p>
        <ul className="list-disc pl-5 font-mono text-xs">
          {GOOGLE_SCOPES.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
        <p>
          Back on Data access, click <strong>Save</strong>. Do not add <code>https://mail.google.com/</code>: Jarvis
          never needs it.
        </p>
      </Item>
      <Item title="Add yourself as a test user and publish the app">
        <p>
          Open <ExtLink href={`${CONSOLE}/auth/audience`}>Audience</ExtLink>. Under “Test users” click{' '}
          <strong>Add users</strong>, enter your Gmail address and Save.
        </p>
        <p>
          Then, under “Publishing status”, click <strong>Publish app</strong> and confirm. While the app stays in
          Testing, Google expires the authorization every 7 days and you would have to reconnect each week. Google
          does not need to review a personal app; when you connect you will see “Google hasn’t verified this app”:
          choose Advanced › Go to Jarvis (unsafe).
        </p>
      </Item>
      <Item title="Create an OAuth client of type Desktop app">
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            Open <ExtLink href={`${CONSOLE}/auth/clients`}>Clients</ExtLink> and click <strong>Create client</strong>.
          </li>
          <li>
            Application type: <strong>Desktop app</strong>. Name: anything (for example “Jarvis”). Leave the other
            options as they are and click <strong>Create</strong>.
          </li>
          <li>
            In the “OAuth client created” dialog click <strong>Download JSON</strong>. Google may show the client
            secret only at this moment; if you closed the dialog without downloading it, delete the client and create
            a new one.
          </li>
          <li>Upload that file below.</li>
        </ol>
      </Item>
    </div>
  );
}
