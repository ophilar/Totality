# Runtime timeline parser plugins

## User stories

- As a user, I can add and edit a web timeline parser after installing the app, without rebuilding it.
- As a user, I can select a parser-defined viewing order and see its source attribution.
- As a user, I can import HTML tables and ordered lists using selectors and declarative field rules.
- As a user, I can refresh maintained franchise timelines from their attributed online sources.
- Existing TMDB, Trakt, registry, and local recipe sources remain available through the same provider registry.

## Functional requirements

- Parser definitions are declarative JSON persisted through the existing settings database or shipped as built-in source definitions.
- The app validates definitions, fetches their configured source, parses selected tables or ordered lists, and rejects changed or incomplete sources visibly.
- The timeline UI supports adding/editing a parser definition and reports parse failures during import.
- Babylon Project, Star Trek (episode-level and Paramount+ series-level), Star Wars, MCU, DCEU, DCU, and Alien/Predator source choices are built-in parser definitions.
- Source descriptions state when a publisher provides series-level order instead of episode-level chronology.

## Success criteria

- A user can add and run table or ordered-list parsers in the installed app without changing source code.
- Existing franchise sources are attributed, refreshable parser definitions instead of fixed timeline snapshots.
- Invalid selectors, source changes, fetch failures, and invalid recipes surface explicit errors.
