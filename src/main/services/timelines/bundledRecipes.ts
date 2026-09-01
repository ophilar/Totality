import type { TimelineDefinition, TimelineItem, TimelineItemIdentifiers, TimelineRecipeSummary } from './ITimelineRecipeProvider'

function epRange(
  seriesTitle: string,
  season: number,
  startEp: number,
  endEp: number,
  timelineEra: string,
  identifiers: TimelineItemIdentifiers
): Array<Omit<TimelineItem, 'order'>> {
  const items: Array<Omit<TimelineItem, 'order'>> = []
  for (let ep = startEp; ep <= endEp; ep++) {
    const sStr = String(season).padStart(2, '0')
    const eStr = String(ep).padStart(2, '0')
    items.push({
      type: 'episode',
      title: `${seriesTitle} S${sStr}E${eStr}`,
      seriesTitle,
      seasonNumber: season,
      episodeNumber: ep,
      timelineEra,
      identifiers,
    })
  }
  return items
}

function singleEp(
  seriesTitle: string,
  season: number,
  ep: number,
  title: string,
  timelineEra: string,
  identifiers: TimelineItemIdentifiers
): Omit<TimelineItem, 'order'> {
  const sStr = String(season).padStart(2, '0')
  const eStr = String(ep).padStart(2, '0')
  return {
    type: 'episode',
    title: `${seriesTitle} S${sStr}E${eStr} - ${title}`,
    seriesTitle,
    seasonNumber: season,
    episodeNumber: ep,
    timelineEra,
    identifiers,
  }
}

function movie(
  title: string,
  airDate: string,
  timelineEra: string,
  identifiers: TimelineItemIdentifiers
): Omit<TimelineItem, 'order'> {
  return {
    type: 'movie',
    title,
    airDate,
    timelineEra,
    identifiers,
  }
}

function createTimeline(
  id: string,
  franchise: string,
  name: string,
  description: string,
  sourceUrl: string,
  rawItems: Array<Omit<TimelineItem, 'order'>>
): TimelineDefinition {
  return {
    id,
    franchise,
    name,
    description,
    sourceUrl,
    version: 2,
    items: rawItems.map((item, idx) => ({
      ...item,
      order: idx + 1,
    })),
  }
}

// ---------------------------------------------------------------------------
// 1. STAR TREK (The Chronology Project Order - Interleaved Episode Level)
// ---------------------------------------------------------------------------
const STAR_TREK_CHRONO_ITEMS: Array<Omit<TimelineItem, 'order'>> = [
  // Enterprise (2151–2155)
  ...epRange('Star Trek: Enterprise', 1, 1, 26, '2151', { tmdbId: 1478, tvdbId: 75711 }),
  ...epRange('Star Trek: Enterprise', 2, 1, 26, '2152', { tmdbId: 1478, tvdbId: 75711 }),
  ...epRange('Star Trek: Enterprise', 3, 1, 24, '2153', { tmdbId: 1478, tvdbId: 75711 }),
  ...epRange('Star Trek: Enterprise', 4, 1, 22, '2154–2155', { tmdbId: 1478, tvdbId: 75711 }),

  // Discovery Season 1 (2256–2257)
  ...epRange('Star Trek: Discovery', 1, 1, 15, '2256–2257', { tmdbId: 67198, tvdbId: 328711 }),

  // Short Treks Season 1 (2257)
  ...epRange('Star Trek: Short Treks', 1, 1, 4, '2257', { tmdbId: 82894, tvdbId: 353243 }),

  // Discovery Season 2 (2257–2258)
  ...epRange('Star Trek: Discovery', 2, 1, 14, '2257–2258', { tmdbId: 67198, tvdbId: 328711 }),

  // Short Treks Season 2 (Discovery / Enterprise / SNW Era episodes)
  singleEp('Star Trek: Short Treks', 2, 1, 'Q&A', '2258', { tmdbId: 82894, tvdbId: 353243 }),
  singleEp('Star Trek: Short Treks', 2, 2, 'The Trouble with Edward', '2258', { tmdbId: 82894, tvdbId: 353243 }),
  singleEp('Star Trek: Short Treks', 2, 3, 'Ask Not', '2258', { tmdbId: 82894, tvdbId: 353243 }),
  singleEp('Star Trek: Short Treks', 2, 4, 'Ephraim and Dot', '2258', { tmdbId: 82894, tvdbId: 353243 }),
  singleEp('Star Trek: Short Treks', 2, 5, 'The Girl Who Made the Stars', '2258', { tmdbId: 82894, tvdbId: 353243 }),

  // Strange New Worlds (2259–present)
  ...epRange('Star Trek: Strange New Worlds', 1, 1, 10, '2259', { tmdbId: 103516, tvdbId: 382348 }),
  ...epRange('Star Trek: Strange New Worlds', 2, 1, 10, '2260', { tmdbId: 103516, tvdbId: 382348 }),
  ...epRange('Star Trek: Strange New Worlds', 3, 1, 10, '2260–2261', { tmdbId: 103516, tvdbId: 382348 }),
  ...epRange('Star Trek: Strange New Worlds', 4, 1, 10, '2261–2262', { tmdbId: 103516, tvdbId: 382348 }),

  // The Original Series (2265–2269)
  ...epRange('Star Trek: The Original Series', 1, 1, 29, '2265–2267', { tmdbId: 253, tvdbId: 77271 }),
  ...epRange('Star Trek: The Original Series', 2, 1, 26, '2267–2268', { tmdbId: 253, tvdbId: 77271 }),
  ...epRange('Star Trek: The Original Series', 3, 1, 24, '2268–2269', { tmdbId: 253, tvdbId: 77271 }),

  // The Animated Series (2269–2270)
  ...epRange('Star Trek: The Animated Series', 1, 1, 16, '2269–2270', { tmdbId: 1992, tvdbId: 76733 }),
  ...epRange('Star Trek: The Animated Series', 2, 1, 6, '2270', { tmdbId: 1992, tvdbId: 76733 }),

  // Original Cast Movies (2273–2293)
  movie('Star Trek: The Motion Picture', '1979-12-07', '2273', { tmdbId: 152, imdbId: 'tt0079945' }),
  movie('Star Trek II: The Wrath of Khan', '1982-06-04', '2285', { tmdbId: 154, imdbId: 'tt0084726' }),
  movie('Star Trek III: The Search for Spock', '1984-06-01', '2285', { tmdbId: 157, imdbId: 'tt0088170' }),
  movie('Star Trek IV: The Voyage Home', '1986-11-26', '2286', { tmdbId: 168, imdbId: 'tt0092007' }),
  movie('Star Trek V: The Final Frontier', '1989-06-09', '2287', { tmdbId: 172, imdbId: 'tt0098382' }),
  movie('Star Trek VI: The Undiscovered Country', '1991-12-06', '2293', { tmdbId: 174, imdbId: 'tt0102975' }),

  // The Next Generation (Seasons 1–5: 2364–2368)
  ...epRange('Star Trek: The Next Generation', 1, 1, 26, '2364', { tmdbId: 655, tvdbId: 71470 }),
  ...epRange('Star Trek: The Next Generation', 2, 1, 22, '2365', { tmdbId: 655, tvdbId: 71470 }),
  ...epRange('Star Trek: The Next Generation', 3, 1, 26, '2366', { tmdbId: 655, tvdbId: 71470 }),
  ...epRange('Star Trek: The Next Generation', 4, 1, 26, '2367', { tmdbId: 655, tvdbId: 71470 }),
  ...epRange('Star Trek: The Next Generation', 5, 1, 26, '2368', { tmdbId: 655, tvdbId: 71470 }),

  // 24th Century Chronological Interleaving: TNG Season 6 & DS9 Season 1 (2369)
  ...epRange('Star Trek: The Next Generation', 6, 1, 11, '2369', { tmdbId: 655, tvdbId: 71470 }),
  ...epRange('Star Trek: Deep Space Nine', 1, 1, 3, '2369', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: The Next Generation', 6, 12, 12, '2369', { tmdbId: 655, tvdbId: 71470 }),
  ...epRange('Star Trek: Deep Space Nine', 1, 4, 4, '2369', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: The Next Generation', 6, 13, 13, '2369', { tmdbId: 655, tvdbId: 71470 }),
  ...epRange('Star Trek: Deep Space Nine', 1, 5, 5, '2369', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: The Next Generation', 6, 14, 14, '2369', { tmdbId: 655, tvdbId: 71470 }),
  ...epRange('Star Trek: Deep Space Nine', 1, 6, 6, '2369', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: The Next Generation', 6, 15, 15, '2369', { tmdbId: 655, tvdbId: 71470 }),
  ...epRange('Star Trek: Deep Space Nine', 1, 7, 7, '2369', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: The Next Generation', 6, 16, 17, '2369', { tmdbId: 655, tvdbId: 71470 }), // Birthright (DS9 Crossover)
  ...epRange('Star Trek: Deep Space Nine', 1, 8, 8, '2369', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: The Next Generation', 6, 18, 18, '2369', { tmdbId: 655, tvdbId: 71470 }),
  ...epRange('Star Trek: Deep Space Nine', 1, 9, 9, '2369', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: The Next Generation', 6, 19, 19, '2369', { tmdbId: 655, tvdbId: 71470 }),
  ...epRange('Star Trek: Deep Space Nine', 1, 10, 10, '2369', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: The Next Generation', 6, 20, 20, '2369', { tmdbId: 655, tvdbId: 71470 }),
  ...epRange('Star Trek: Deep Space Nine', 1, 11, 11, '2369', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: The Next Generation', 6, 21, 21, '2369', { tmdbId: 655, tvdbId: 71470 }),
  ...epRange('Star Trek: Deep Space Nine', 1, 12, 12, '2369', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: The Next Generation', 6, 22, 22, '2369', { tmdbId: 655, tvdbId: 71470 }),
  ...epRange('Star Trek: Deep Space Nine', 1, 13, 13, '2369', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: The Next Generation', 6, 23, 23, '2369', { tmdbId: 655, tvdbId: 71470 }),
  ...epRange('Star Trek: Deep Space Nine', 1, 14, 14, '2369', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: The Next Generation', 6, 24, 24, '2369', { tmdbId: 655, tvdbId: 71470 }),
  ...epRange('Star Trek: Deep Space Nine', 1, 15, 15, '2369', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: The Next Generation', 6, 25, 25, '2369', { tmdbId: 655, tvdbId: 71470 }),
  ...epRange('Star Trek: Deep Space Nine', 1, 16, 19, '2369', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: The Next Generation', 6, 26, 26, '2369', { tmdbId: 655, tvdbId: 71470 }),
  ...epRange('Star Trek: Deep Space Nine', 1, 20, 20, '2369', { tmdbId: 580, tvdbId: 72073 }),

  // TNG Season 7 & DS9 Season 2 (2370)
  ...epRange('Star Trek: Deep Space Nine', 2, 1, 1, '2370', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: The Next Generation', 7, 1, 1, '2370', { tmdbId: 655, tvdbId: 71470 }),
  ...epRange('Star Trek: Deep Space Nine', 2, 2, 2, '2370', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: The Next Generation', 7, 2, 2, '2370', { tmdbId: 655, tvdbId: 71470 }),
  ...epRange('Star Trek: Deep Space Nine', 2, 3, 3, '2370', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: The Next Generation', 7, 3, 3, '2370', { tmdbId: 655, tvdbId: 71470 }),
  ...epRange('Star Trek: Deep Space Nine', 2, 4, 4, '2370', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: The Next Generation', 7, 4, 4, '2370', { tmdbId: 655, tvdbId: 71470 }),
  ...epRange('Star Trek: Deep Space Nine', 2, 5, 5, '2370', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: The Next Generation', 7, 5, 5, '2370', { tmdbId: 655, tvdbId: 71470 }),
  ...epRange('Star Trek: Deep Space Nine', 2, 6, 6, '2370', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: The Next Generation', 7, 6, 6, '2370', { tmdbId: 655, tvdbId: 71470 }),
  ...epRange('Star Trek: Deep Space Nine', 2, 7, 7, '2370', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: The Next Generation', 7, 7, 7, '2370', { tmdbId: 655, tvdbId: 71470 }),
  ...epRange('Star Trek: Deep Space Nine', 2, 8, 8, '2370', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: The Next Generation', 7, 8, 8, '2370', { tmdbId: 655, tvdbId: 71470 }),
  ...epRange('Star Trek: Deep Space Nine', 2, 9, 9, '2370', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: The Next Generation', 7, 9, 9, '2370', { tmdbId: 655, tvdbId: 71470 }),
  ...epRange('Star Trek: Deep Space Nine', 2, 10, 10, '2370', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: The Next Generation', 7, 10, 10, '2370', { tmdbId: 655, tvdbId: 71470 }),
  ...epRange('Star Trek: Deep Space Nine', 2, 11, 11, '2370', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: The Next Generation', 7, 11, 11, '2370', { tmdbId: 655, tvdbId: 71470 }),
  ...epRange('Star Trek: Deep Space Nine', 2, 12, 12, '2370', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: The Next Generation', 7, 12, 12, '2370', { tmdbId: 655, tvdbId: 71470 }),
  ...epRange('Star Trek: Deep Space Nine', 2, 13, 13, '2370', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: The Next Generation', 7, 13, 13, '2370', { tmdbId: 655, tvdbId: 71470 }),
  ...epRange('Star Trek: Deep Space Nine', 2, 14, 14, '2370', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: The Next Generation', 7, 14, 14, '2370', { tmdbId: 655, tvdbId: 71470 }),
  ...epRange('Star Trek: Deep Space Nine', 2, 15, 15, '2370', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: The Next Generation', 7, 15, 15, '2370', { tmdbId: 655, tvdbId: 71470 }),
  ...epRange('Star Trek: Deep Space Nine', 2, 16, 16, '2370', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: The Next Generation', 7, 16, 16, '2370', { tmdbId: 655, tvdbId: 71470 }),
  ...epRange('Star Trek: Deep Space Nine', 2, 17, 17, '2370', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: The Next Generation', 7, 17, 17, '2370', { tmdbId: 655, tvdbId: 71470 }),
  ...epRange('Star Trek: Deep Space Nine', 2, 18, 18, '2370', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: The Next Generation', 7, 18, 18, '2370', { tmdbId: 655, tvdbId: 71470 }),
  ...epRange('Star Trek: Deep Space Nine', 2, 19, 19, '2370', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: The Next Generation', 7, 19, 19, '2370', { tmdbId: 655, tvdbId: 71470 }),
  ...epRange('Star Trek: Deep Space Nine', 2, 20, 21, '2370', { tmdbId: 580, tvdbId: 72073 }), // The Maquis, Parts I & II
  ...epRange('Star Trek: The Next Generation', 7, 20, 21, '2370', { tmdbId: 655, tvdbId: 71470 }),
  ...epRange('Star Trek: Deep Space Nine', 2, 22, 22, '2370', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: The Next Generation', 7, 22, 22, '2370', { tmdbId: 655, tvdbId: 71470 }),
  ...epRange('Star Trek: Deep Space Nine', 2, 23, 23, '2370', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: The Next Generation', 7, 23, 23, '2370', { tmdbId: 655, tvdbId: 71470 }),
  ...epRange('Star Trek: Deep Space Nine', 2, 24, 24, '2370', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: The Next Generation', 7, 24, 24, '2370', { tmdbId: 655, tvdbId: 71470 }),
  ...epRange('Star Trek: Deep Space Nine', 2, 25, 25, '2370', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: The Next Generation', 7, 25, 26, '2370', { tmdbId: 655, tvdbId: 71470 }), // All Good Things...
  ...epRange('Star Trek: Deep Space Nine', 2, 26, 26, '2370', { tmdbId: 580, tvdbId: 72073 }),

  // Movie: Star Trek: Generations (2371)
  movie('Star Trek: Generations', '1994-11-18', '2371', { tmdbId: 193, imdbId: 'tt0111281' }),

  // DS9 Season 3 & Voyager Launch (2371)
  ...epRange('Star Trek: Deep Space Nine', 3, 1, 9, '2371', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: Voyager', 1, 1, 2, '2371', { tmdbId: 1855, tvdbId: 74550 }), // Caretaker (departs from DS9)
  ...epRange('Star Trek: Deep Space Nine', 3, 10, 12, '2371', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: Voyager', 1, 3, 3, '2371', { tmdbId: 1855, tvdbId: 74550 }),
  ...epRange('Star Trek: Deep Space Nine', 3, 13, 13, '2371', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: Voyager', 1, 4, 4, '2371', { tmdbId: 1855, tvdbId: 74550 }),
  ...epRange('Star Trek: Deep Space Nine', 3, 14, 14, '2371', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: Voyager', 1, 5, 5, '2371', { tmdbId: 1855, tvdbId: 74550 }),
  ...epRange('Star Trek: Deep Space Nine', 3, 15, 15, '2371', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: Voyager', 1, 6, 6, '2371', { tmdbId: 1855, tvdbId: 74550 }),
  ...epRange('Star Trek: Deep Space Nine', 3, 16, 16, '2371', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: Voyager', 1, 7, 7, '2371', { tmdbId: 1855, tvdbId: 74550 }),
  ...epRange('Star Trek: Deep Space Nine', 3, 17, 17, '2371', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: Voyager', 1, 8, 8, '2371', { tmdbId: 1855, tvdbId: 74550 }),
  ...epRange('Star Trek: Deep Space Nine', 3, 18, 18, '2371', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: Voyager', 1, 9, 9, '2371', { tmdbId: 1855, tvdbId: 74550 }),
  ...epRange('Star Trek: Deep Space Nine', 3, 19, 19, '2371', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: Voyager', 1, 10, 10, '2371', { tmdbId: 1855, tvdbId: 74550 }),
  ...epRange('Star Trek: Deep Space Nine', 3, 20, 21, '2371', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: Voyager', 1, 11, 11, '2371', { tmdbId: 1855, tvdbId: 74550 }),
  ...epRange('Star Trek: Deep Space Nine', 3, 22, 22, '2371', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: Voyager', 1, 12, 12, '2371', { tmdbId: 1855, tvdbId: 74550 }),
  ...epRange('Star Trek: Deep Space Nine', 3, 23, 23, '2371', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: Voyager', 1, 13, 13, '2371', { tmdbId: 1855, tvdbId: 74550 }),
  ...epRange('Star Trek: Deep Space Nine', 3, 24, 24, '2371', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: Voyager', 1, 14, 14, '2371', { tmdbId: 1855, tvdbId: 74550 }),
  ...epRange('Star Trek: Deep Space Nine', 3, 25, 25, '2371', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: Voyager', 1, 15, 15, '2371', { tmdbId: 1855, tvdbId: 74550 }),
  ...epRange('Star Trek: Deep Space Nine', 3, 26, 26, '2371', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: Voyager', 1, 16, 16, '2371', { tmdbId: 1855, tvdbId: 74550 }),

  // DS9 Season 4 & Voyager Season 2 (2372)
  ...epRange('Star Trek: Deep Space Nine', 4, 1, 2, '2372', { tmdbId: 580, tvdbId: 72073 }), // The Way of the Warrior
  ...epRange('Star Trek: Voyager', 2, 1, 1, '2372', { tmdbId: 1855, tvdbId: 74550 }),
  ...epRange('Star Trek: Deep Space Nine', 4, 3, 3, '2372', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: Voyager', 2, 2, 2, '2372', { tmdbId: 1855, tvdbId: 74550 }),
  ...epRange('Star Trek: Deep Space Nine', 4, 4, 4, '2372', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: Voyager', 2, 3, 3, '2372', { tmdbId: 1855, tvdbId: 74550 }),
  ...epRange('Star Trek: Deep Space Nine', 4, 5, 5, '2372', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: Voyager', 2, 4, 4, '2372', { tmdbId: 1855, tvdbId: 74550 }),
  ...epRange('Star Trek: Deep Space Nine', 4, 6, 6, '2372', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: Voyager', 2, 5, 5, '2372', { tmdbId: 1855, tvdbId: 74550 }),
  ...epRange('Star Trek: Deep Space Nine', 4, 7, 7, '2372', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: Voyager', 2, 6, 6, '2372', { tmdbId: 1855, tvdbId: 74550 }),
  ...epRange('Star Trek: Deep Space Nine', 4, 8, 8, '2372', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: Voyager', 2, 7, 7, '2372', { tmdbId: 1855, tvdbId: 74550 }),
  ...epRange('Star Trek: Deep Space Nine', 4, 9, 9, '2372', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: Voyager', 2, 8, 8, '2372', { tmdbId: 1855, tvdbId: 74550 }),
  ...epRange('Star Trek: Deep Space Nine', 4, 10, 10, '2372', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: Voyager', 2, 9, 10, '2372', { tmdbId: 1855, tvdbId: 74550 }),
  ...epRange('Star Trek: Deep Space Nine', 4, 11, 12, '2372', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: Voyager', 2, 11, 11, '2372', { tmdbId: 1855, tvdbId: 74550 }),
  ...epRange('Star Trek: Deep Space Nine', 4, 13, 13, '2372', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: Voyager', 2, 12, 12, '2372', { tmdbId: 1855, tvdbId: 74550 }),
  ...epRange('Star Trek: Deep Space Nine', 4, 14, 14, '2372', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: Voyager', 2, 13, 13, '2372', { tmdbId: 1855, tvdbId: 74550 }),
  ...epRange('Star Trek: Deep Space Nine', 4, 15, 15, '2372', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: Voyager', 2, 14, 14, '2372', { tmdbId: 1855, tvdbId: 74550 }),
  ...epRange('Star Trek: Deep Space Nine', 4, 16, 16, '2372', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: Voyager', 2, 15, 15, '2372', { tmdbId: 1855, tvdbId: 74550 }),
  ...epRange('Star Trek: Deep Space Nine', 4, 17, 17, '2372', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: Voyager', 2, 16, 16, '2372', { tmdbId: 1855, tvdbId: 74550 }),
  ...epRange('Star Trek: Deep Space Nine', 4, 18, 18, '2372', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: Voyager', 2, 17, 17, '2372', { tmdbId: 1855, tvdbId: 74550 }),
  ...epRange('Star Trek: Deep Space Nine', 4, 19, 19, '2372', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: Voyager', 2, 18, 18, '2372', { tmdbId: 1855, tvdbId: 74550 }),
  ...epRange('Star Trek: Deep Space Nine', 4, 20, 20, '2372', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: Voyager', 2, 19, 19, '2372', { tmdbId: 1855, tvdbId: 74550 }),
  ...epRange('Star Trek: Deep Space Nine', 4, 21, 21, '2372', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: Voyager', 2, 20, 20, '2372', { tmdbId: 1855, tvdbId: 74550 }),
  ...epRange('Star Trek: Deep Space Nine', 4, 22, 22, '2372', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: Voyager', 2, 21, 21, '2372', { tmdbId: 1855, tvdbId: 74550 }),
  ...epRange('Star Trek: Deep Space Nine', 4, 23, 23, '2372', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: Voyager', 2, 22, 22, '2372', { tmdbId: 1855, tvdbId: 74550 }),
  ...epRange('Star Trek: Deep Space Nine', 4, 24, 24, '2372', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: Voyager', 2, 23, 23, '2372', { tmdbId: 1855, tvdbId: 74550 }),
  ...epRange('Star Trek: Deep Space Nine', 4, 25, 25, '2372', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: Voyager', 2, 24, 24, '2372', { tmdbId: 1855, tvdbId: 74550 }),
  ...epRange('Star Trek: Deep Space Nine', 4, 26, 26, '2372', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: Voyager', 2, 25, 26, '2372', { tmdbId: 1855, tvdbId: 74550 }),

  // DS9 Season 5, First Contact & Voyager Season 3 (2373)
  ...epRange('Star Trek: Deep Space Nine', 5, 1, 8, '2373', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: Voyager', 3, 1, 8, '2373', { tmdbId: 1855, tvdbId: 74550 }),
  movie('Star Trek: First Contact', '1996-11-22', '2373', { tmdbId: 199, imdbId: 'tt0117731' }),
  ...epRange('Star Trek: Deep Space Nine', 5, 9, 13, '2373', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: Voyager', 3, 9, 13, '2373', { tmdbId: 1855, tvdbId: 74550 }),
  ...epRange('Star Trek: Deep Space Nine', 5, 14, 18, '2373', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: Voyager', 3, 14, 18, '2373', { tmdbId: 1855, tvdbId: 74550 }),
  ...epRange('Star Trek: Deep Space Nine', 5, 19, 26, '2373', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: Voyager', 3, 19, 26, '2373', { tmdbId: 1855, tvdbId: 74550 }),

  // DS9 Season 6 & Voyager Season 4 (2374)
  ...epRange('Star Trek: Deep Space Nine', 6, 1, 6, '2374', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: Voyager', 4, 1, 6, '2374', { tmdbId: 1855, tvdbId: 74550 }),
  ...epRange('Star Trek: Deep Space Nine', 6, 7, 12, '2374', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: Voyager', 4, 7, 12, '2374', { tmdbId: 1855, tvdbId: 74550 }),
  ...epRange('Star Trek: Deep Space Nine', 6, 13, 18, '2374', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: Voyager', 4, 13, 18, '2374', { tmdbId: 1855, tvdbId: 74550 }),
  ...epRange('Star Trek: Deep Space Nine', 6, 19, 26, '2374', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: Voyager', 4, 19, 26, '2374', { tmdbId: 1855, tvdbId: 74550 }),

  // Movie: Star Trek: Insurrection, DS9 Season 7 & Voyager Season 5 (2375)
  ...epRange('Star Trek: Deep Space Nine', 7, 1, 8, '2375', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: Voyager', 5, 1, 8, '2375', { tmdbId: 1855, tvdbId: 74550 }),
  movie('Star Trek: Insurrection', '1998-12-11', '2375', { tmdbId: 200, imdbId: 'tt0120844' }),
  ...epRange('Star Trek: Deep Space Nine', 7, 9, 16, '2375', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: Voyager', 5, 9, 16, '2375', { tmdbId: 1855, tvdbId: 74550 }),
  ...epRange('Star Trek: Deep Space Nine', 7, 17, 26, '2375', { tmdbId: 580, tvdbId: 72073 }),
  ...epRange('Star Trek: Voyager', 5, 17, 26, '2375', { tmdbId: 1855, tvdbId: 74550 }),

  // Voyager Seasons 6 & 7 (2376–2378)
  ...epRange('Star Trek: Voyager', 6, 1, 26, '2376', { tmdbId: 1855, tvdbId: 74550 }),
  ...epRange('Star Trek: Voyager', 7, 1, 26, '2377–2378', { tmdbId: 1855, tvdbId: 74550 }),

  // Movie: Star Trek: Nemesis (2379)
  movie('Star Trek: Nemesis', '2002-12-13', '2379', { tmdbId: 201, imdbId: 'tt0253754' }),

  // Lower Decks (2380–2384)
  ...epRange('Star Trek: Lower Decks', 1, 1, 10, '2380', { tmdbId: 85949, tvdbId: 369848 }),
  ...epRange('Star Trek: Lower Decks', 2, 1, 10, '2381', { tmdbId: 85949, tvdbId: 369848 }),
  ...epRange('Star Trek: Lower Decks', 3, 1, 10, '2382', { tmdbId: 85949, tvdbId: 369848 }),
  ...epRange('Star Trek: Lower Decks', 4, 1, 10, '2383', { tmdbId: 85949, tvdbId: 369848 }),
  ...epRange('Star Trek: Lower Decks', 5, 1, 10, '2384', { tmdbId: 85949, tvdbId: 369848 }),

  // Prodigy (2383–2385)
  ...epRange('Star Trek: Prodigy', 1, 1, 20, '2383–2384', { tmdbId: 106393, tvdbId: 385554 }),
  ...epRange('Star Trek: Prodigy', 2, 1, 20, '2384–2385', { tmdbId: 106393, tvdbId: 385554 }),

  // Short Treks (2385 - Picard Prelude)
  singleEp('Star Trek: Short Treks', 2, 6, 'Children of Mars', '2385', { tmdbId: 82894, tvdbId: 353243 }),

  // Picard (2399–2401)
  ...epRange('Star Trek: Picard', 1, 1, 10, '2399', { tmdbId: 85948, tvdbId: 364089 }),
  ...epRange('Star Trek: Picard', 2, 1, 10, '2401', { tmdbId: 85948, tvdbId: 364089 }),
  ...epRange('Star Trek: Picard', 3, 1, 10, '2401', { tmdbId: 85948, tvdbId: 364089 }),

  // Discovery 32nd Century (3188–3191)
  ...epRange('Star Trek: Discovery', 3, 1, 13, '3188–3189', { tmdbId: 67198, tvdbId: 328711 }),
  ...epRange('Star Trek: Discovery', 4, 1, 13, '3190', { tmdbId: 67198, tvdbId: 328711 }),
  ...epRange('Star Trek: Discovery', 5, 1, 10, '3191', { tmdbId: 67198, tvdbId: 328711 }),

  // Movie: Star Trek: Section 31 (2025 / 32nd Century)
  movie('Star Trek: Section 31', '2025-01-24', '32nd Century', { tmdbId: 579298 }),
]

// ---------------------------------------------------------------------------
// 2. STAR WARS (Canon Chronological Order - Interleaved Episodes & Films)
// ---------------------------------------------------------------------------
const STAR_WARS_CANON_ITEMS: Array<Omit<TimelineItem, 'order'>> = [
  // Prequels
  movie('Star Wars: Episode I - The Phantom Menace', '1999-05-19', '32 BBY', { tmdbId: 1893, imdbId: 'tt0120915' }),
  movie('Star Wars: Episode II - Attack of the Clones', '2002-05-16', '22 BBY', { tmdbId: 1894, imdbId: 'tt0121765' }),

  // The Clone Wars (Canon Chronological Sequence interleaved with film)
  singleEp('Star Wars: The Clone Wars', 2, 16, 'Cat and Mouse', '22 BBY', { tmdbId: 4194, tvdbId: 83268 }),
  singleEp('Star Wars: The Clone Wars', 1, 16, 'Hidden Enemy', '22 BBY', { tmdbId: 4194, tvdbId: 83268 }),
  movie('Star Wars: The Clone Wars', '2008-08-15', '22 BBY', { tmdbId: 12180, imdbId: 'tt1185834' }),
  singleEp('Star Wars: The Clone Wars', 3, 1, 'Clone Cadets', '22 BBY', { tmdbId: 4194, tvdbId: 83268 }),
  singleEp('Star Wars: The Clone Wars', 3, 3, 'Supply Lines', '22 BBY', { tmdbId: 4194, tvdbId: 83268 }),
  ...epRange('Star Wars: The Clone Wars', 1, 1, 15, '22 BBY', { tmdbId: 4194, tvdbId: 83268 }),
  ...epRange('Star Wars: The Clone Wars', 1, 17, 21, '22 BBY', { tmdbId: 4194, tvdbId: 83268 }),
  ...epRange('Star Wars: The Clone Wars', 2, 1, 3, '21 BBY', { tmdbId: 4194, tvdbId: 83268 }),
  ...epRange('Star Wars: The Clone Wars', 2, 17, 19, '21 BBY', { tmdbId: 4194, tvdbId: 83268 }),
  ...epRange('Star Wars: The Clone Wars', 2, 4, 14, '21 BBY', { tmdbId: 4194, tvdbId: 83268 }),
  ...epRange('Star Wars: The Clone Wars', 2, 20, 22, '21 BBY', { tmdbId: 4194, tvdbId: 83268 }),
  ...epRange('Star Wars: The Clone Wars', 3, 5, 7, '21 BBY', { tmdbId: 4194, tvdbId: 83268 }),
  singleEp('Star Wars: The Clone Wars', 3, 2, 'ARC Troopers', '21 BBY', { tmdbId: 4194, tvdbId: 83268 }),
  singleEp('Star Wars: The Clone Wars', 3, 4, 'Sphere of Influence', '21 BBY', { tmdbId: 4194, tvdbId: 83268 }),
  ...epRange('Star Wars: The Clone Wars', 3, 8, 22, '21 BBY', { tmdbId: 4194, tvdbId: 83268 }),
  ...epRange('Star Wars: The Clone Wars', 4, 1, 22, '20 BBY', { tmdbId: 4194, tvdbId: 83268 }),
  ...epRange('Star Wars: The Clone Wars', 5, 2, 13, '20 BBY', { tmdbId: 4194, tvdbId: 83268 }),
  singleEp('Star Wars: The Clone Wars', 5, 1, 'Revival', '20 BBY', { tmdbId: 4194, tvdbId: 83268 }),
  ...epRange('Star Wars: The Clone Wars', 5, 14, 20, '20 BBY', { tmdbId: 4194, tvdbId: 83268 }),
  ...epRange('Star Wars: The Clone Wars', 6, 1, 13, '19 BBY', { tmdbId: 4194, tvdbId: 83268 }),
  ...epRange('Star Wars: The Clone Wars', 7, 5, 8, '19 BBY', { tmdbId: 4194, tvdbId: 83268 }),
  ...epRange('Star Wars: The Clone Wars', 7, 1, 4, '19 BBY', { tmdbId: 4194, tvdbId: 83268 }),

  // Episode III & Siege of Mandalore
  movie('Star Wars: Episode III - Revenge of the Sith', '2005-05-19', '19 BBY', { tmdbId: 1895, imdbId: 'tt0121766' }),
  ...epRange('Star Wars: The Clone Wars', 7, 9, 12, '19 BBY', { tmdbId: 4194, tvdbId: 83268 }),

  // The Bad Batch (19 BBY)
  ...epRange('Star Wars: The Bad Batch', 1, 1, 16, '19 BBY', { tmdbId: 105971, tvdbId: 385376 }),
  ...epRange('Star Wars: The Bad Batch', 2, 1, 16, '18 BBY', { tmdbId: 105971, tvdbId: 385376 }),
  ...epRange('Star Wars: The Bad Batch', 3, 1, 15, '18 BBY', { tmdbId: 105971, tvdbId: 385376 }),

  // Solo, Obi-Wan Kenobi, Andor
  movie('Solo: A Star Wars Story', '2018-05-25', '10 BBY', { tmdbId: 348350, imdbId: 'tt3778644' }),
  ...epRange('Obi-Wan Kenobi', 1, 1, 6, '9 BBY', { tmdbId: 92783, tvdbId: 382322 }),
  ...epRange('Andor', 1, 1, 12, '5 BBY', { tmdbId: 83867, tvdbId: 385375 }),

  // Rebels (5–0 BBY)
  ...epRange('Star Wars Rebels', 1, 1, 15, '5–4 BBY', { tmdbId: 60554, tvdbId: 283468 }),
  ...epRange('Star Wars Rebels', 2, 1, 22, '4–3 BBY', { tmdbId: 60554, tvdbId: 283468 }),
  ...epRange('Star Wars Rebels', 3, 1, 22, '2–1 BBY', { tmdbId: 60554, tvdbId: 283468 }),
  ...epRange('Star Wars Rebels', 4, 1, 16, '1–0 BBY', { tmdbId: 60554, tvdbId: 283468 }),

  // Rogue One & Original Trilogy (0 BBY – 4 ABY)
  movie('Rogue One: A Star Wars Story', '2016-12-16', '0 BBY', { tmdbId: 330459, imdbId: 'tt3748528' }),
  movie('Star Wars: Episode IV - A New Hope', '1977-05-25', '0 BBY / 0 ABY', { tmdbId: 11, imdbId: 'tt0076759' }),
  movie('Star Wars: Episode V - The Empire Strikes Back', '1980-05-21', '3 ABY', { tmdbId: 1891, imdbId: 'tt0080684' }),
  movie('Star Wars: Episode VI - Return of the Jedi', '1983-05-25', '4 ABY', { tmdbId: 1892, imdbId: 'tt0086190' }),

  // New Republic & Mando-verse (9–10 ABY)
  ...epRange('The Mandalorian', 1, 1, 8, '9 ABY', { tmdbId: 82856, tvdbId: 361753 }),
  ...epRange('The Mandalorian', 2, 1, 8, '9 ABY', { tmdbId: 82856, tvdbId: 361753 }),
  ...epRange('The Book of Boba Fett', 1, 1, 7, '9 ABY', { tmdbId: 115036, tvdbId: 393636 }),
  ...epRange('The Mandalorian', 3, 1, 8, '9 ABY', { tmdbId: 82856, tvdbId: 361753 }),
  ...epRange('Ahsoka', 1, 1, 8, '9–10 ABY', { tmdbId: 114461, tvdbId: 393635 }),
  ...epRange('Skeleton Crew', 1, 1, 8, '9–10 ABY', { tmdbId: 202879, tvdbId: 420456 }),

  // Resistance & Sequel Trilogy (34–35 ABY)
  ...epRange('Star Wars Resistance', 1, 1, 21, '34 ABY', { tmdbId: 82491, tvdbId: 350567 }),
  movie('Star Wars: Episode VII - The Force Awakens', '2015-12-18', '34 ABY', { tmdbId: 140607, imdbId: 'tt2488496' }),
  movie('Star Wars: Episode VIII - The Last Jedi', '2017-12-15', '34 ABY', { tmdbId: 181808, imdbId: 'tt2527336' }),
  ...epRange('Star Wars Resistance', 2, 1, 19, '34–35 ABY', { tmdbId: 82491, tvdbId: 350567 }),
  movie('Star Wars: Episode IX - The Rise of Skywalker', '2019-12-20', '35 ABY', { tmdbId: 181812, imdbId: 'tt2527338' }),
]

// ---------------------------------------------------------------------------
// 3. MARVEL CINEMATIC UNIVERSE (MCU Chronology - Interleaved Episodes & Films)
// ---------------------------------------------------------------------------
const MCU_CHRONO_ITEMS: Array<Omit<TimelineItem, 'order'>> = [
  movie('Captain America: The First Avenger', '2011-07-22', '1942–1945', { tmdbId: 1771, imdbId: 'tt0458339' }),
  movie('Captain Marvel', '2019-03-08', '1995', { tmdbId: 299537, imdbId: 'tt4154664' }),
  movie('Iron Man', '2008-05-02', '2010', { tmdbId: 1726, imdbId: 'tt0371746' }),
  movie('Iron Man 2', '2010-05-07', '2011', { tmdbId: 10138, imdbId: 'tt1228705' }),
  movie('The Incredible Hulk', '2008-06-13', '2011', { tmdbId: 1724, imdbId: 'tt0800080' }),
  movie('Thor', '2011-05-06', '2011', { tmdbId: 10195, imdbId: 'tt0800369' }),
  movie('The Avengers', '2012-05-04', '2012', { tmdbId: 24428, imdbId: 'tt0848228' }),
  movie('Iron Man 3', '2013-05-03', '2012', { tmdbId: 68721, imdbId: 'tt1300854' }),
  movie('Thor: The Dark World', '2013-11-08', '2013', { tmdbId: 76338, imdbId: 'tt1981115' }),
  movie('Captain America: The Winter Soldier', '2014-04-04', '2014', { tmdbId: 100402, imdbId: 'tt1843866' }),
  movie('Guardians of the Galaxy', '2014-08-01', '2014', { tmdbId: 118340, imdbId: 'tt2015381' }),
  movie('Guardians of the Galaxy Vol. 2', '2017-05-05', '2014', { tmdbId: 283995, imdbId: 'tt3896198' }),
  movie('Avengers: Age of Ultron', '2015-05-01', '2015', { tmdbId: 99861, imdbId: 'tt2395427' }),
  movie('Ant-Man', '2015-07-17', '2015', { tmdbId: 102899, imdbId: 'tt0478970' }),
  movie('Captain America: Civil War', '2016-05-06', '2016', { tmdbId: 271110, imdbId: 'tt3498820' }),
  movie('Black Widow', '2021-07-09', '2016', { tmdbId: 497698, imdbId: 'tt3480822' }),
  movie('Black Panther', '2018-02-16', '2016', { tmdbId: 284054, imdbId: 'tt1825683' }),
  movie('Spider-Man: Homecoming', '2017-07-07', '2016', { tmdbId: 315635, imdbId: 'tt2250912' }),
  movie('Doctor Strange', '2016-11-04', '2016–2017', { tmdbId: 284052, imdbId: 'tt1211837' }),
  movie('Thor: Ragnarok', '2017-11-03', '2017', { tmdbId: 284053, imdbId: 'tt3501632' }),
  movie('Ant-Man and the Wasp', '2018-07-06', '2018', { tmdbId: 363088, imdbId: 'tt5095030' }),
  movie('Avengers: Infinity War', '2018-04-27', '2018', { tmdbId: 299536, imdbId: 'tt4154756' }),
  movie('Avengers: Endgame', '2019-04-26', '2018–2023', { tmdbId: 299534, imdbId: 'tt4154796' }),

  // Post-Endgame Multiverse & Disney+ Interleaving
  ...epRange('Loki', 1, 1, 6, 'Multiverse', { tmdbId: 84958, tvdbId: 362240 }),
  ...epRange('WandaVision', 1, 1, 9, '2023', { tmdbId: 85271, tvdbId: 362540 }),
  movie('Shang-Chi and the Legend of the Ten Rings', '2021-09-03', '2023–2024', { tmdbId: 566525, imdbId: 'tt9376612' }),
  ...epRange('The Falcon and the Winter Soldier', 1, 1, 6, '2024', { tmdbId: 88396, tvdbId: 362541 }),
  movie('Spider-Man: Far From Home', '2019-07-02', '2024', { tmdbId: 429617, imdbId: 'tt6320628' }),
  movie('Eternals', '2021-11-05', '2024', { tmdbId: 524434, imdbId: 'tt9032400' }),
  movie('Spider-Man: No Way Home', '2021-12-17', '2024', { tmdbId: 634649, imdbId: 'tt10872600' }),
  ...epRange('Hawkeye', 1, 1, 6, '2024', { tmdbId: 88329, tvdbId: 362542 }),
  ...epRange('Moon Knight', 1, 1, 6, '2025', { tmdbId: 92749, tvdbId: 368142 }),
  movie('Doctor Strange in the Multiverse of Madness', '2022-05-06', '2025', { tmdbId: 453395, imdbId: 'tt9419884' }),
  ...epRange('Ms. Marvel', 1, 1, 6, '2025', { tmdbId: 92782, tvdbId: 368143 }),
  movie('Thor: Love and Thunder', '2022-07-08', '2025', { tmdbId: 616037, imdbId: 'tt10648342' }),
  ...epRange('She-Hulk: Attorney at Law', 1, 1, 9, '2025', { tmdbId: 92783, tvdbId: 368144 }),
  movie('Black Panther: Wakanda Forever', '2022-11-11', '2025', { tmdbId: 505642, imdbId: 'tt9114286' }),
  movie('Ant-Man and the Wasp: Quantumania', '2023-02-17', '2026', { tmdbId: 640146, imdbId: 'tt10954600' }),
  movie('Guardians of the Galaxy Vol. 3', '2023-05-05', '2026', { tmdbId: 447365, imdbId: 'tt6791350' }),
  ...epRange('Secret Invasion', 1, 1, 6, '2026', { tmdbId: 114472, tvdbId: 393637 }),
  movie('The Marvels', '2023-11-10', '2026', { tmdbId: 609681, imdbId: 'tt10676048' }),
  ...epRange('Loki', 2, 1, 6, 'Multiverse', { tmdbId: 84958, tvdbId: 362240 }),
  ...epRange('Echo', 1, 1, 5, '2026', { tmdbId: 138502, tvdbId: 412497 }),
  movie('Deadpool & Wolverine', '2024-07-26', '2026', { tmdbId: 533535, imdbId: 'tt6263850' }),
]

// ---------------------------------------------------------------------------
// 4. DC EXTENDED UNIVERSE (DCEU Chronology - Interleaved Episodes & Films)
// ---------------------------------------------------------------------------
const DCU_CHRONO_ITEMS: Array<Omit<TimelineItem, 'order'>> = [
  movie('Wonder Woman', '2017-06-02', '1918', { tmdbId: 297762, imdbId: 'tt0451279' }),
  movie('Wonder Woman 1984', '2020-12-25', '1984', { tmdbId: 464052, imdbId: 'tt7144666' }),
  movie('Man of Steel', '2013-06-14', '2013', { tmdbId: 49521, imdbId: 'tt0770828' }),
  movie('Batman v Superman: Dawn of Justice', '2016-03-25', '2015', { tmdbId: 209112, imdbId: 'tt2975590' }),
  movie('Suicide Squad', '2016-08-05', '2016', { tmdbId: 297761, imdbId: 'tt1386697' }),
  movie('Justice League', '2017-11-17', '2017', { tmdbId: 141052, imdbId: 'tt0974015' }),
  movie('Aquaman', '2018-12-21', '2018', { tmdbId: 297802, imdbId: 'tt1477834' }),
  movie('Shazam!', '2019-04-05', '2018', { tmdbId: 287947, imdbId: 'tt0448115' }),
  movie('Birds of Prey', '2020-02-07', '2020', { tmdbId: 495764, imdbId: 'tt7713068' }),
  movie('The Suicide Squad', '2021-08-06', '2021', { tmdbId: 436969, imdbId: 'tt6334354' }),
  ...epRange('Peacemaker', 1, 1, 8, '2021', { tmdbId: 110492, tvdbId: 388707 }),
  movie('Black Adam', '2022-10-21', '2022', { tmdbId: 436270, imdbId: 'tt6443340' }),
  movie('Shazam! Fury of the Gods', '2023-03-17', '2022', { tmdbId: 594767, imdbId: 'tt10151854' }),
  movie('The Flash', '2023-06-16', '2023', { tmdbId: 298618, imdbId: 'tt0439572' }),
  movie('Blue Beetle', '2023-08-18', '2023', { tmdbId: 565770, imdbId: 'tt9362722' }),
  movie('Aquaman and the Lost Kingdom', '2023-12-22', '2023', { tmdbId: 572802, imdbId: 'tt9663764' }),
]

// ---------------------------------------------------------------------------
// 5. ALIEN & PREDATOR (Chronological Order)
// ---------------------------------------------------------------------------
const ALIEN_PREDATOR_CHRONO_ITEMS: Array<Omit<TimelineItem, 'order'>> = [
  movie('Prey', '2022-08-05', '1719', { tmdbId: 766507, imdbId: 'tt11866324' }),
  movie('Predator', '1987-06-12', '1987', { tmdbId: 106, imdbId: 'tt0093773' }),
  movie('Predator 2', '1990-11-21', '1997', { tmdbId: 169, imdbId: 'tt0100403' }),
  movie('Alien vs. Predator', '2004-08-13', '2004', { tmdbId: 395, imdbId: 'tt0370263' }),
  movie('Aliens vs Predator: Requiem', '2007-12-25', '2004', { tmdbId: 440, imdbId: 'tt0758730' }),
  movie('The Predator', '2018-09-14', '2018', { tmdbId: 346910, imdbId: 'tt3829266' }),
  movie('Predators', '2010-07-09', '2010s', { tmdbId: 34851, imdbId: 'tt1424381' }),
  movie('Prometheus', '2012-06-08', '2089–2093', { tmdbId: 70981, imdbId: 'tt1446714' }),
  movie('Alien: Covenant', '2017-05-19', '2104', { tmdbId: 126889, imdbId: 'tt2316204' }),
  movie('Alien', '1979-05-25', '2122', { tmdbId: 348, imdbId: 'tt0078748' }),
  movie('Alien: Romulus', '2024-08-16', '2142', { tmdbId: 945961, imdbId: 'tt18412256' }),
  movie('Aliens', '1986-07-18', '2179', { tmdbId: 679, imdbId: 'tt0090605' }),
  movie('Alien 3', '1992-05-22', '2179', { tmdbId: 8077, imdbId: 'tt0103644' }),
]

// ---------------------------------------------------------------------------
// 6. BABYLON 5 (Release-order complete franchise preset)
// ---------------------------------------------------------------------------
const BABYLON_5_COMPLETE_ITEMS: Array<Omit<TimelineItem, 'order'>> = [
  movie('Babylon 5: The Gathering', '1993-02-22', 'Pilot', { imdbId: 'tt0106062' }),
  ...epRange('Babylon 5', 1, 1, 22, '2258', { tmdbId: 7073 }),
  ...epRange('Babylon 5', 2, 1, 22, '2259', { tmdbId: 7073 }),
  ...epRange('Babylon 5', 3, 1, 22, '2260', { tmdbId: 7073 }),
  movie('Babylon 5: In the Beginning', '1998-01-04', 'Pre-2258 history', { imdbId: 'tt0116627' }),
  ...epRange('Babylon 5', 4, 1, 22, '2261', { tmdbId: 7073 }),
  movie('Babylon 5: Thirdspace', '1998-07-19', '2261', { imdbId: 'tt0121804' }),
  movie('Babylon 5: The River of Souls', '1998-11-08', '2263', { imdbId: 'tt0120828' }),
  ...epRange('Babylon 5', 5, 1, 22, '2262–2263', { tmdbId: 7073 }),
  movie('Babylon 5: A Call to Arms', '1999-01-03', '2267', { imdbId: 'tt0120844' }),
  ...epRange('Crusade', 1, 1, 13, '2267', { tmdbId: 7074 }),
  singleEp('Babylon 5: The Legend of the Rangers', 1, 1, 'To Live and Die in Starlight', '2271', { imdbId: 'tt0256430' }),
  singleEp('Babylon 5: The Lost Tales', 1, 1, 'Voices of Darkness', '2271', { imdbId: 'tt0871201' }),
  singleEp('Babylon 5: The Lost Tales', 1, 2, 'Over Here', '2271', { imdbId: 'tt0871201' }),
  movie('Babylon 5: The Road Home', '2023-08-15', '2261 alternate timeline', { imdbId: 'tt27743549' }),
]

export const BUNDLED_RECIPES: Record<string, TimelineDefinition> = {
  'star-trek-chronological': createTimeline(
    'star-trek-chronological',
    'Star Trek',
    'Star Trek (The Chronology Project Order)',
    'In-universe canonical chronological viewing order with fully interleaved TV episodes and movies from Enterprise (2151) through Section 31 (32nd Century).',
    'https://startrekviewingguide.com/',
    STAR_TREK_CHRONO_ITEMS
  ),
  'star-wars-canon': createTimeline(
    'star-wars-canon',
    'Star Wars',
    'Star Wars (Canon Chronological Order)',
    'Official Lucasfilm canon chronological order with fully interleaved Clone Wars episodes, animated series, live-action series, and theatrical films.',
    'https://www.ign.com/articles/star-wars-movies-in-order',
    STAR_WARS_CANON_ITEMS
  ),
  'mcu-chronological': createTimeline(
    'mcu-chronological',
    'Marvel',
    'Marvel Cinematic Universe (MCU Chronology)',
    'Sacred timeline chronological viewing order with all Disney+ series episodes interleaved between theatrical releases.',
    'https://www.ign.com/articles/marvel-movies-in-order',
    MCU_CHRONO_ITEMS
  ),
  'dcu-chronological': createTimeline(
    'dcu-chronological',
    'DC',
    'DC Extended Universe (DCEU Chronology)',
    'Chronological timeline of DC Extended Universe films and television series starting with Wonder Woman (1918).',
    'https://www.ign.com/articles/dc-movies-in-order',
    DCU_CHRONO_ITEMS
  ),
  'alien-predator-chronological': createTimeline(
    'alien-predator-chronological',
    'Alien / Predator',
    'Alien & Predator (Chronological Order)',
    'Chronological timeline from Prey (1719) and Predator through Prometheus, Alien, Aliens, and Alien: Romulus.',
    'https://www.ign.com/articles/alien-movies-in-order',
    ALIEN_PREDATOR_CHRONO_ITEMS
  ),
  'babylon-5-complete': createTimeline(
    'babylon-5-complete',
    'Babylon 5',
    'Babylon 5 (Complete Release Order)',
    'Curated complete Babylon 5 franchise order covering the pilot, all Babylon 5 and Crusade episodes, The Lost Tales, The Legend of the Rangers, and all six television/animated movies.',
    'https://www.babylon5.com/',
    BABYLON_5_COMPLETE_ITEMS
  ),
}

export const BUNDLED_MANIFEST: TimelineRecipeSummary[] = Object.values(BUNDLED_RECIPES).map((recipe) => ({
  id: recipe.id,
  name: recipe.name,
  franchise: recipe.franchise,
  description: recipe.description,
  totalItems: recipe.items.length,
  sourceType: 'preset',
}))
