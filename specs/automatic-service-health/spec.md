# Automatic service health and lower-friction settings

## User stories

- A saved TMDB or Gemini credential is checked automatically at startup and after its saved configuration changes.
- A user sees an actual saved credential result, selected Gemini model availability, and actionable source errors without periodic renderer polling.
- Playback target changes are validated against the same contract enforced by main-process IPC, and unsaved work can be saved, discarded, or kept open before switching profiles.
- Hardware detection reports the available devices without silently writing a GPU preference.

## Functional requirements

1. Credential validation is session-only, cancellable on configuration replacement, revisioned, and never broadcasts credential values. Provider unavailability and rate limiting do not imply invalid credentials.
2. Startup and saved-configuration checks use read-only provider APIs. They do not generate AI content, scan libraries, or mutate saved profile or source settings.
3. Source availability checks run when the configured source set changes, not on a separate periodic timer. Local sources are checked for directory access without walking their contents.
4. Playback profile renderer and IPC validation share one authoritative schema. Unsaved switching offers Save, Discard, and Keep editing.
5. Capability inspection never chooses or persists a GPU for the user. Saved unavailable GPU selections remain diagnosable.
6. Existing update-check policy and cadence remain intact; concurrent checks coalesce, timers are cleaned up, and availability is communicated through the update UI.

## Success criteria

- TMDB and Gemini cards never label a stored key valid before a successful provider request.
- Ordinary service initialization does not start duplicate checks. Old check results cannot overwrite status after configuration changes.
- Startup health checks do not modify settings or launch AI generation, media scans, or remote commands.
- No 30-second renderer-owned source check timer remains.
- Profile drafts are validated through the IPC schema before save and remain intact when a save fails.
- GPU discovery does not persist a selection or infer the first detected device.
- Full test suite and packaged build pass; live provider, performance, cancellation, and constrained-window acceptance are reported separately.
