import type { TimelineDefinition } from '../ITimelineRecipeProvider'

export const STAR_TREK_AIR_DATE: TimelineDefinition = {
  id: 'star-trek-airdate',
  franchise: 'Star Trek',
  name: 'Star Trek (Air-Date / Release Order)',
  description: 'Star Trek TV episodes and movies in the order they originally aired and released into theaters.',
  version: 1,
  items: [
    // TOS
    { order: 1, type: 'episode', title: 'The Man Trap', seriesTitle: 'Star Trek: The Original Series', seasonNumber: 1, episodeNumber: 1, airDate: '1966-09-08', timelineEra: '23rd Century', identifiers: { tmdbId: 253, tvdbId: 77526 } },
    // Films
    { order: 80, type: 'movie', title: 'Star Trek: The Motion Picture', airDate: '1979-12-07', timelineEra: '2270s', identifiers: { tmdbId: 152, imdbId: 'tt0079945' } },
    { order: 81, type: 'movie', title: 'Star Trek II: The Wrath of Khan', airDate: '1982-06-04', timelineEra: '2285', identifiers: { tmdbId: 154, imdbId: 'tt0084726' } },
    { order: 82, type: 'movie', title: 'Star Trek III: The Search for Spock', airDate: '1984-06-01', timelineEra: '2285', identifiers: { tmdbId: 157, imdbId: 'tt0088170' } },
    { order: 83, type: 'movie', title: 'Star Trek IV: The Voyage Home', airDate: '1986-11-26', timelineEra: '2286', identifiers: { tmdbId: 168, imdbId: 'tt0092007' } },
    // TNG
    { order: 84, type: 'episode', title: 'Encounter at Farpoint', seriesTitle: 'Star Trek: The Next Generation', seasonNumber: 1, episodeNumber: 1, airDate: '1987-09-28', timelineEra: '2364', identifiers: { tmdbId: 655, tvdbId: 71470 } },
    { order: 130, type: 'movie', title: 'Star Trek V: The Final Frontier', airDate: '1989-06-09', timelineEra: '2287', identifiers: { tmdbId: 172, imdbId: 'tt0098382' } },
    { order: 180, type: 'movie', title: 'Star Trek VI: The Undiscovered Country', airDate: '1991-12-06', timelineEra: '2293', identifiers: { tmdbId: 174, imdbId: 'tt0102975' } },
    // DS9 starts
    { order: 200, type: 'episode', title: 'Emissary', seriesTitle: 'Star Trek: Deep Space Nine', seasonNumber: 1, episodeNumber: 1, airDate: '1993-01-03', timelineEra: '2369', identifiers: { tmdbId: 580, tvdbId: 72073 } },
    // Generations
    { order: 250, type: 'movie', title: 'Star Trek: Generations', airDate: '1994-11-18', timelineEra: '2371', identifiers: { tmdbId: 193, imdbId: 'tt0111281' } },
    // Voyager starts
    { order: 260, type: 'episode', title: 'Caretaker', seriesTitle: 'Star Trek: Voyager', seasonNumber: 1, episodeNumber: 1, airDate: '1995-01-16', timelineEra: '2371', identifiers: { tmdbId: 1855, tvdbId: 74550 } },
    // First Contact
    { order: 300, type: 'movie', title: 'Star Trek: First Contact', airDate: '1996-11-22', timelineEra: '2373', identifiers: { tmdbId: 199, imdbId: 'tt0117731' } },
    // Insurrection
    { order: 350, type: 'movie', title: 'Star Trek: Insurrection', airDate: '1998-12-11', timelineEra: '2375', identifiers: { tmdbId: 200, imdbId: 'tt0120844' } },
    // Nemesis
    { order: 450, type: 'movie', title: 'Star Trek: Nemesis', airDate: '2002-12-13', timelineEra: '2379', identifiers: { tmdbId: 201, imdbId: 'tt0253754' } },
    // Enterprise
    { order: 460, type: 'episode', title: 'Broken Bow', seriesTitle: 'Star Trek: Enterprise', seasonNumber: 1, episodeNumber: 1, airDate: '2001-09-26', timelineEra: '2151', identifiers: { tmdbId: 1478, tvdbId: 75711 } },
    // Modern Era (Discovery, Picard, SNW)
    { order: 550, type: 'episode', title: 'The Vulcan Hello', seriesTitle: 'Star Trek: Discovery', seasonNumber: 1, episodeNumber: 1, airDate: '2017-09-24', timelineEra: '2256', identifiers: { tmdbId: 67198, tvdbId: 328711 } },
    { order: 600, type: 'episode', title: 'Remembrance', seriesTitle: 'Star Trek: Picard', seasonNumber: 1, episodeNumber: 1, airDate: '2020-01-23', timelineEra: '2399', identifiers: { tmdbId: 85949, tvdbId: 364093 } },
    { order: 650, type: 'episode', title: 'Strange New Worlds', seriesTitle: 'Star Trek: Strange New Worlds', seasonNumber: 1, episodeNumber: 1, airDate: '2022-05-05', timelineEra: '2259', identifiers: { tmdbId: 103516, tvdbId: 382963 } },
  ]
}

export const STAR_TREK_CHRONOLOGICAL: TimelineDefinition = {
  id: 'star-trek-chronological',
  franchise: 'Star Trek',
  name: 'Star Trek (The Chronology Project Order)',
  description: 'In-universe narrative chronological viewing order based on stardates and canonical events.',
  sourceUrl: 'https://thestartrekchronologyproject.blogspot.com',
  version: 1,
  items: [
    // 22nd Century: Enterprise
    { order: 1, type: 'episode', title: 'Broken Bow', seriesTitle: 'Star Trek: Enterprise', seasonNumber: 1, episodeNumber: 1, airDate: '2001-09-26', timelineEra: '2151 (22nd Century)', identifiers: { tmdbId: 1478, tvdbId: 75711 } },
    // Mid 23rd Century: Discovery S1-S2 & Strange New Worlds
    { order: 100, type: 'episode', title: 'The Vulcan Hello', seriesTitle: 'Star Trek: Discovery', seasonNumber: 1, episodeNumber: 1, airDate: '2017-09-24', timelineEra: '2256', identifiers: { tmdbId: 67198, tvdbId: 328711 } },
    { order: 130, type: 'episode', title: 'Strange New Worlds', seriesTitle: 'Star Trek: Strange New Worlds', seasonNumber: 1, episodeNumber: 1, airDate: '2022-05-05', timelineEra: '2259', identifiers: { tmdbId: 103516, tvdbId: 382963 } },
    // Late 23rd Century: TOS & TOS Films
    { order: 160, type: 'episode', title: 'The Man Trap', seriesTitle: 'Star Trek: The Original Series', seasonNumber: 1, episodeNumber: 1, airDate: '1966-09-08', timelineEra: '2266', identifiers: { tmdbId: 253, tvdbId: 77526 } },
    { order: 240, type: 'movie', title: 'Star Trek: The Motion Picture', airDate: '1979-12-07', timelineEra: '2270s', identifiers: { tmdbId: 152, imdbId: 'tt0079945' } },
    { order: 241, type: 'movie', title: 'Star Trek II: The Wrath of Khan', airDate: '1982-06-04', timelineEra: '2285', identifiers: { tmdbId: 154, imdbId: 'tt0084726' } },
    { order: 242, type: 'movie', title: 'Star Trek III: The Search for Spock', airDate: '1984-06-01', timelineEra: '2285', identifiers: { tmdbId: 157, imdbId: 'tt0088170' } },
    { order: 243, type: 'movie', title: 'Star Trek IV: The Voyage Home', airDate: '1986-11-26', timelineEra: '2286', identifiers: { tmdbId: 168, imdbId: 'tt0092007' } },
    { order: 244, type: 'movie', title: 'Star Trek V: The Final Frontier', airDate: '1989-06-09', timelineEra: '2287', identifiers: { tmdbId: 172, imdbId: 'tt0098382' } },
    { order: 245, type: 'movie', title: 'Star Trek VI: The Undiscovered Country', airDate: '1991-12-06', timelineEra: '2293', identifiers: { tmdbId: 174, imdbId: 'tt0102975' } },
    // 24th Century: TNG, DS9, VOY, TNG Films
    { order: 250, type: 'episode', title: 'Encounter at Farpoint', seriesTitle: 'Star Trek: The Next Generation', seasonNumber: 1, episodeNumber: 1, airDate: '1987-09-28', timelineEra: '2364', identifiers: { tmdbId: 655, tvdbId: 71470 } },
    { order: 390, type: 'episode', title: 'Emissary', seriesTitle: 'Star Trek: Deep Space Nine', seasonNumber: 1, episodeNumber: 1, airDate: '1993-01-03', timelineEra: '2369', identifiers: { tmdbId: 580, tvdbId: 72073 } },
    { order: 430, type: 'movie', title: 'Star Trek: Generations', airDate: '1994-11-18', timelineEra: '2371', identifiers: { tmdbId: 193, imdbId: 'tt0111281' } },
    { order: 440, type: 'episode', title: 'Caretaker', seriesTitle: 'Star Trek: Voyager', seasonNumber: 1, episodeNumber: 1, airDate: '1995-01-16', timelineEra: '2371', identifiers: { tmdbId: 1855, tvdbId: 74550 } },
    { order: 480, type: 'movie', title: 'Star Trek: First Contact', airDate: '1996-11-22', timelineEra: '2373', identifiers: { tmdbId: 199, imdbId: 'tt0117731' } },
    { order: 520, type: 'movie', title: 'Star Trek: Insurrection', airDate: '1998-12-11', timelineEra: '2375', identifiers: { tmdbId: 200, imdbId: 'tt0120844' } },
    { order: 600, type: 'movie', title: 'Star Trek: Nemesis', airDate: '2002-12-13', timelineEra: '2379', identifiers: { tmdbId: 201, imdbId: 'tt0253754' } },
    // Late 24th / Early 25th Century: Picard
    { order: 610, type: 'episode', title: 'Remembrance', seriesTitle: 'Star Trek: Picard', seasonNumber: 1, episodeNumber: 1, airDate: '2020-01-23', timelineEra: '2399', identifiers: { tmdbId: 85949, tvdbId: 364093 } },
    // Far Future: Discovery S3-S5 (32nd Century)
    { order: 700, type: 'episode', title: 'That Hope Is You, Part 1', seriesTitle: 'Star Trek: Discovery', seasonNumber: 3, episodeNumber: 1, airDate: '2020-10-15', timelineEra: '3188 (32nd Century)', identifiers: { tmdbId: 67198, tvdbId: 328711 } },
  ]
}
