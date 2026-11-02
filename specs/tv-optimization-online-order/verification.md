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

## Follow-up verification — 2026-10-01

This section updates the earlier evidence and catalog conclusions. The follow-up delivered four contained code commits:

- `724c370`: activation recovery now commits the recorded transition and complete optimization-job accounting after placement, including the window before the next journal write. The unsafe size-only recovery branch was removed.
- `68b4c8e`: metadata credentials use the existing database configuration API; parser footnotes and release years are handled; authoritative TMDB aliases and external identifiers resolve publisher titles. Canonical imports correct duplicate bundled parser/database instances that skipped enrichment or hid configured credentials.
- `535dd49`: target plans and command builders bound peak bitrate and buffering by documented codec main-tier limits. Measurement failure/cancellation removes owned references, metric logs and partial samples; successful candidate samples remain available. Cleanup failures include the original error.
- `c415f72`: preflight rejects conversion to unverified HDR output formats, including HLG, instead of accepting a transfer function the conversion filter does not implement. Native HLG preservation is unchanged. The real-process HDR regression and final packaged build passed after this guard.

### Live guides, built UI and restart recovery

- The final built app refreshed StarWars.com once and reused that snapshot for resolution. Its 28 publisher blocks expanded to 51 displayed positions: **28 matched, 23 missing, zero ambiguous**. Matches include all 24 Andor episodes and Rogue One, A New Hope, The Empire Strikes Back and Return of the Jedi. Current publisher additions were retained, including Maul – Shadow Lord and The Mandalorian and Grogu.
- The earlier 27 unmatched publisher entries were **not evidence of catalog absence**. Footnotes, title aliases, missing metadata credentials and bundled class identity prevented legitimate matches. After those fixes, the remaining 23 identities were missing from the selected cached catalog. A separate title audit found only unrelated Rebel Speeder extras as substring candidates for Star Wars Rebels.
- The built-app stale-guide flow used a registered parser and a publisher excerpt over a real local HTTP connection. Closing that server produced an actual refresh failure. The UI displayed the stale error and retrieval timestamp; cancellation preserved playlists; missing stale authorization was rejected; explicit confirmation published the reviewed sequence to a uniquely owned disposable Plex playlist. Publication performed no provider refetch. The disposable playlist was removed.
- **Eleven activation restart states passed** using real encoding, files and databases: six replacement boundaries and five quarantine-replacement boundaries, including placement before the journal update, metadata commitment and original removal.
- **Six Plex publication restart states passed** against the real server: building without a saved stage key, building, verified, renamed before the journal update, published, and published after previous-playlist deletion. Owned playlists were cleaned up; watch-history values were preserved.

### Genuine HDR encoder coverage

The matrix used genuine bounded HDR10, HDR10+ and HLG inputs, five verified encoders, MKV output at up to 1280×720, preserved source cadence, configured AAC conversion and three 30-second sections per case. The HDR10+ fixture retained real HDR10+ metadata after removing Dolby Vision RPU from a dual-format source. No color metadata was fabricated. AV1 checks used an explicit acceptance profile allowing AV1.

Each successful case checked output codec/color, cadence, audio track/channel counts, VMAF/CAMBI and full sample decoding. **Twenty-eight of thirty cases passed.** The VMAF >85 acceptance threshold checks conversion viability; production preflight continues to enforce its independently selected quality gates. These clips are candidate playback artifacts, not approved user-library optimization plans.

| Genuine source → SDR and HDR10 | NVENC HEVC | NVENC AV1 | QSV HEVC | x265 | SVT-AV1 |
| --- | --- | --- | --- | --- | --- |
| HDR10+ | Both passed | Both passed | Both passed | Both passed | Both passed |
| HDR10 | Both passed | Both blocked | Both passed | Both passed | Both passed |
| HLG | Both passed | Both passed | Both passed | Both passed | Both passed |

The two blocked cases are the high-bitrate HDR10 fixture through NVENC AV1 at the reviewed main-tier level 5.2, 60 Mbps peak bitrate and level-bounded buffer. This driver rejected both SDR and HDR10 outputs with `Invalid Level`. A diagnostic automatic-level encode emitted AV1 level 7.3, exceeding the reviewed target maximum. That diagnostic does not establish support for the approved plan. Other encoder selections must pass their own preflight and playback approval.

### Final checks and remaining gates

- The final typecheck passed. The final full test run reported **208 files and 1,615 tests passed**, seven opt-in cases skipped, and one native Windows worker crash (`0xC0000005`) in `LibrarySettingsTab.test.tsx`; it did not exit cleanly. That suite then passed all seven tests in isolation. The native full-run crash remains unexplained. The updated eight-case real measurement suite passed in the final run, including genuine process cancellation and owned-file cleanup.
- The final packaged build passed and produced `release/Totality-Setup-0.5.1.exe` from the committed source.
- Physical playback remains pending: the connected Samsung Galaxy Tab S7+ was locked throughout these checks; no physical TV or phone was available. Decoder checks and desktop-player evidence do not substitute for target-device visual approval.
- Dolby Vision profiles beyond the previously verified profile 8, dynamic-metadata preservation, other color/profile/container combinations, and the blocked NVENC AV1 settings remain unsupported or unverified.
- This Plex server still removes repeated media entries. Exact sequence verification preserves the previous playlist when publication cannot reproduce the reviewed order.

No library optimization or original deletion ran against user media. Publication used uniquely owned disposable playlists. Isolated databases, credential copies, bounded input clips and comparison files were removed. **Eighty-four candidate samples** remain under `dev_docs/acceptance-20261001/matrix` for the pending device checks; sanitized logs, `hdr-results.json` and the stale-guide screenshot remain in the acceptance directory.

## Remaining non-Dolby-Vision investigation — 2026-10-01

Database closure now clears the Drizzle reference as well as the native client and repositories. Previously the public ORM accessor still exposed the closed client. The added real database lifecycle case closes and reopens the same persisted database, verifies that the closed accessor rejects access, and confirms that settings survive reopening with a newly constructed ORM.

The final normal `npm test -- --maxWorkers=1` exited successfully: typecheck passed, **209 files and 1,617 tests passed**, with two opt-in files/seven tests skipped. The earlier control run without external encoding load still crashed a native worker in `IntegratedLifecycle.test.tsx` after 1,616 passed tests; that two-case suite passed separately. The intermittent native fault did not recur in the final run, but its cause has not been established. [The upstream libSQL report](https://github.com/tursodatabase/libsql-js/issues/231) describes a similar Windows teardown fault using an in-memory database; it does not prove that this file-backed failure has the same cause. A debugger diagnostic slowed FFmpeg children into a timeout and was stopped; it is excluded from acceptance evidence. Windows rejected detaching those children, so no native faulting module was captured.

The remaining NVENC AV1 rejection reproduces with a retained native-HDR10-derived HEVC sample, independently of reading the original high-bitrate file. At preserved 24000/1001 cadence and AV1 level index 14 (5.2), CQ peak rates of 30, 40 and 60 Mbps fail encoder initialization, while 20 Mbps succeeds and reports level 14. VBR with a 20 Mbps average/60 Mbps peak also fails; level 6.0 with a 60 Mbps peak fails. These are bounded one-second configuration diagnostics, not new playback-approved plans. No arbitrary rate cap, cadence change, encoder substitution or automatic-level bypass was introduced. [FFmpeg's NVENC implementation](https://github.com/FFmpeg/FFmpeg/blob/master/libavcodec/nvenc.c) discards the supplied VBV buffer in CQ mode, so changing that buffer cannot resolve this rejection. The two reviewed high-bitrate NVENC AV1 conversion cases remain unsupported on the tested configuration.

Plex's documented API additionally supports constructing playlists from play queues. A fresh disposable probe could not test that path: the configured credentials now return HTTP 401 even for listing playlists. No playlist was created, and the probe's credential copy and directory were removed. Existing individual-entry staging and exact-sequence verification remain intact; repeated-entry publication is still unverified through the play-queue API. Physical playback also remains blocked because the Samsung tablet is locked. Dolby Vision implementation was excluded from this follow-up.

Sanitized evidence: `dev_docs/acceptance-20261001/remaining-final-tests.log`, `av1-config-probe.log`, `plex-queue-probe.log`, and `remaining-final-build.log`.

The final packaged `npm run build` exited successfully and produced `release/Totality-Setup-0.5.1.exe`. Database lifecycle changes are committed in `32818b9`. No user media optimization, original deletion or user-playlist publication occurred in this follow-up.
