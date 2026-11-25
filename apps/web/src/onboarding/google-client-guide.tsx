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
      <Item title="Configure the OAuth consent screen">
        <p>
          Open the <ExtLink href={`${CONSOLE}/apis/credentials/consent`}>OAuth consent screen</ExtLink>, choose
          “External”, fill in the app name and your email, and add these five scopes:
        </p>
        <ul className="list-disc pl-5 font-mono text-xs">
          {GOOGLE_SCOPES.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
        <p>Add yourself as a test user.</p>
        <p>
          Then <strong>publish the app to production</strong>. Google shows an “unverified app” warning when you
          connect; that is expected for a personal app, continue past it. While the app stays in Testing, Google
          expires the authorization every 7 days and you would have to reconnect each week.
        </p>
      </Item>
      <Item title="Create an OAuth client of type Desktop app">
        <p>
          In <ExtLink href={`${CONSOLE}/apis/credentials`}>Credentials</ExtLink>, choose Create credentials › OAuth
          client ID, set the application type to <strong>Desktop app</strong>, create it and download the JSON file.
          Upload that file below.
        </p>
      </Item>
    </div>
  );
}
