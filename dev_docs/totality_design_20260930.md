# TV optimization and viewing-order decisions — 2026-09-30

Extend the existing command-builder strategy and service APIs instead of adding a parallel optimization pipeline. An approved episode plan is the authority for streams, encoder settings, conversions, profile, source fingerprint and output mode. Actual sample evidence gates approval; full output verification gates journaled activation. Frame cadence remains the source cadence.

Reuse the canonical FFprobe parser for both worker and main-process analysis, including bounded frame side data for HDR10+ and actual Dolby Vision profiles. Materialize lossless transformed reference clips for hardware color conversion before metric comparison; inline multi-input hardware filters produced incorrect reference synchronization in real measurements.

Keep online provider selection explicit. A retrieved snapshot is the authority for resolution, preview and publication. Changing the selected library source re-resolves that snapshot. Failed refresh exposes the previous snapshot and its error; stale publication requires authorization for that snapshot. Canonical source ownership and unambiguous series identity govern resolution.

Extend existing activation jobs and settings publication records for recovery. A staged Plex sequence is verified before publication and previous-playlist deletion. A server that cannot reproduce deliberate repeats is rejected rather than silently changing the reviewed order. No watch-history mutation is needed.
