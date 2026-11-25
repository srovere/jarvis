-- A Google account's primary calendar was stored twice: as the 'primary' alias and under its real id, which for
-- Google is the account's email address. Jarvis now always uses 'primary'; fold the real id into it.
UPDATE accounts SET calendars_busy = ARRAY(
  SELECT DISTINCT CASE WHEN lower(c) = lower(accounts.email) THEN 'primary' ELSE c END FROM unnest(calendars_busy) AS c
)
WHERE provider = 'google' AND lower(accounts.email) = ANY(SELECT lower(c) FROM unnest(calendars_busy) AS c);
--> statement-breakpoint
-- Its copy of the events (cascades from calendars) and its sync cursor; the 'primary' copy is kept or re-synced.
DELETE FROM calendars USING accounts
WHERE calendars.account_id = accounts.id AND accounts.provider = 'google' AND lower(calendars.external_id) = lower(accounts.email);
--> statement-breakpoint
DELETE FROM sync_state USING accounts
WHERE sync_state.account_id = accounts.id AND accounts.provider = 'google'
  AND lower(sync_state.resource) = 'calendar:' || lower(accounts.email);
