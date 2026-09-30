# Implementation verification — 2026-09-30

## Delivered behavior

The existing optimization services now carry a frozen episode plan from measurement through approval and execution. Plans retain source and sample fingerprints, stream selection, encoder settings, conversions, playback profile, and output mode. Cadence is preserved. Three bounded sections feed VMAF/CAMBI quality gates and retained playback samples. Resizing and compatible audio conversion preserve channel count and track identity; incompatible retained subtitles and protected audio block the episode.

Activation decodes the complete output, verifies tracks, timing, color, size and target compatibility, then records the replacement transition. Complete active-file analysis is committed before original deletion. Quarantine ownership and encoded reduction, retained original bytes and physical recovery remain distinct. Cancellation, cleanup and show controls use owned artifacts and batch scope.

Viewing guides refresh explicitly on opening. Retrieval date, fingerprint, granularity, unresolved matches and stale-refresh error accompany the snapshot. Source changes resolve that same snapshot. Plex publication uses the reviewed sequence and selected source, stages and verifies the playlist, and records interrupted publication progress. The Mandalorian preset entries have their correct identities.

## Verification evidence

- Final test/typecheck pipeline: 208 files passed, 1,611 tests passed, seven opt-in hardware/HDR cases skipped in the normal run (210 files / 1,618 cases total). The skipped cases were executed separately against real hardware and genuine HDR clips as listed below. Duration: 302.09 seconds.
- Packaged Windows installer: `npm run build` passed; `release/Totality-Setup-0.5.1.exe` was produced from the final source. The final review text/summary changes also passed the focused show/service run (23 tests).
- Real software measurement: x265 and SVT-AV1, three sections, CAMBI/VMAF, proportional resize, audio conversion and full decoding.
- Real activation flows with disposable media: replacement, quarantine discovery after extension change, refreshed output analysis, cancellation and encoder failure cleanup, source preservation, frozen approval and batch isolation.
- Hardware acceptance: NVENC HEVC, NVENC AV1 and QSV HEVC passed real measurement and decoding. Intel UHD 770 AV1 encoding failed the real capability probe and is excluded from the verified encoder list.
- Genuine 4K HDR acceptance: six cases passed in 609.57 seconds. Dolby Vision profile 8, HDR10+ and HLG each converted to SDR and HDR10 with NVENC HEVC; every case measured three sections, preserved cadence, checked output color metadata and decoded each output sample. The acceptance threshold of VMAF >85 checks conversion viability; production preflight separately applies the selected stricter quality gates.
- Real built Electron app: isolated source registration and scan, show dialog, explicit selections, measured preflight, three retained samples and mandatory playback approval. A fresh app exposed and verified fixes for Windows profile filenames and FFmpeg initialization.
- Installed VLC: disposable AV1 and HEVC playback completed with real video output and exit code 0. These checks do not constitute visual approval on a television, phone or tablet.
- Real Plex: disposable staged publication and rating-key replacement matched the reviewed sequence; watch-history values were unchanged. A rejected repeated-entry sequence left the previous reviewed playlist intact. All owned disposable playlists were removed.
- Online guide/database/IPC regressions cover publisher additions, visible stale refresh, snapshot reuse without refetch, ambiguous and cross-source matches, completeness expansion, duplicate identities and Andor/Mandalorian entries.
- Live online guide and local-library resolution: refreshed the registered StarWars.com guide in the built Electron app and resolved that exact snapshot against a read-only clone of the configured Plex database. The current page supplied 28 series-block entries, including Maul – Shadow Lord and The Mandalorian and Grogu (2026); resolution found one local match, 27 visibly missing entries, and no ambiguous matches. Reuse preserved the selected Plex source, retrieval timestamp and content fingerprint; no playlist was published. The page provides series/season blocks, so episode interleaving is not claimed.
- Forced-restart recovery: in a disposable database and media tree, terminated the actual Electron process tree after recording the `source_quarantined` replacement journal transition. Relaunch recovered the recorded output, committed its analysis to the active path, cleared the journal, and removed only the owned temporary output and quarantined original.

## Unsupported and unverified combinations

- This Plex server removes repeated media entries. Sequence verification rejects such a publication and preserves the previous playlist; deliberate repeats remain visible in the viewing guide.
- Dolby Vision profiles other than profile 8 have not been validated. Native preservation of Dolby Vision or HDR10+ dynamic metadata is not claimed; explicit conversion discloses its loss and requires real sample validation.
- Genuine HDR was validated with NVENC HEVC. The complete encoder/color/profile/container matrix, physical target-device playback and subjective visual quality remain unverified. Unsupported retained track semantics block preflight.
- The live guide snapshot resolved against the configured local Plex catalog with 27 missing entries. This confirms those guide identities were not available for this catalog snapshot; no inference was made about the reason for each absence. Live refresh failure and explicit stale-snapshot authorization remain covered by the existing controlled HTTP/IPC regression, not by an injected outage against the public provider.
- Real user media was read only for bounded HDR fixture extraction. No optimization or deletion ran against the user library. Publication testing used only uniquely owned disposable playlists.

## Reproduction

Run `npm test -- --maxWorkers=1`, then `npm run build`. Opt-in hardware acceptance uses `TOTALITY_HARDWARE_ACCEPTANCE=1` (see the test's environment contract); genuine HDR acceptance uses `TOTALITY_HDR_FIXTURES` pointing to bounded `DV8.mkv`, `HDR10.mkv` and `HLG.mkv` clips. Genuine media and credentials are excluded from Git. Owned acceptance media, isolated databases and credential copies were removed after validation. Local sanitized logs and screenshots remain under `dev_docs/acceptance-20260930`.
