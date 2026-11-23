/** Scopes OAuth exactos de Jarvis. Nunca incluir `https://mail.google.com/`. */
export const GOOGLE_SCOPES: readonly string[] = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/tasks',
];
