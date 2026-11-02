import { JSDOM } from 'jsdom'
import { getDatabase } from '@main/database/BetterSQLiteService'
import { validateTimelineDefinition } from './TimelineValidation'
import type { ITimelineRecipeProvider, TimelineDefinition, TimelineItem, TimelineRecipeSummary, TimelineFetchOptions } from './ITimelineRecipeProvider'
import { TimelineParserPluginSchema, type TimelineParserGroupDefinition, type TimelineParserListDefinition, type TimelineParserOrder, type TimelineParserPlugin } from './TimelineParserPlugin'
import alienPredatorParser from './parser-plugins/alien-predator.json'
import babylonProjectParser from './parser-plugins/babylon-project.json'
import dcExtendedUniverseParser from './parser-plugins/dc-extended-universe.json'
import dcUniverseParser from './parser-plugins/dc-universe.json'
import marvelParser from './parser-plugins/marvel.json'
import starTrekParser from './parser-plugins/star-trek.json'
import starTrekParamountParser from './parser-plugins/star-trek-paramount.json'
import starWarsParser from './parser-plugins/star-wars.json'
import { getTimelineCacheService, TimelineCacheService } from './TimelineCacheService'
import { normalizeMediaTitle } from './TimelineResolutionEngine'

const SETTING_KEY = 'custom_timeline_parsers'
const BUILT_IN_PLUGINS = [
  TimelineParserPluginSchema.parse(babylonProjectParser),
  TimelineParserPluginSchema.parse(starTrekParser),
  TimelineParserPluginSchema.parse(starTrekParamountParser),
  TimelineParserPluginSchema.parse(starWarsParser),
  TimelineParserPluginSchema.parse(marvelParser),
  TimelineParserPluginSchema.parse(dcExtendedUniverseParser),
  TimelineParserPluginSchema.parse(dcUniverseParser),
  TimelineParserPluginSchema.parse(alienPredatorParser),
]

export class TimelineParserPluginProvider implements ITimelineRecipeProvider {
  constructor(private readonly cacheService: TimelineCacheService = getTimelineCacheService()) {}

  async listAvailableRecipes(): Promise<TimelineRecipeSummary[]> {
    const plugins = await this.readPlugins()
    return plugins.flatMap(plugin => plugin.orders.map(order => ({
      id: `${plugin.id}:${order.id}`,
      name: order.name,
      franchise: plugin.franchise,
      description: `${order.description} Source: ${plugin.attribution}.`,
      totalItems: 0,
      sourceType: 'web' as const,
      sourceUrl: this.orderSourceUrl(plugin, order),
      granularity: typeof order.order !== 'string' && 'kind' in order.order && order.order.format !== 'star-trek-guide' ? 'series-blocks' as const : 'episode-interleaved' as const,
    })))
  }

  async fetchTimeline(idOrUrl: string, options: TimelineFetchOptions = {}): Promise<TimelineDefinition> {
    const selected = await this.findOrder(idOrUrl.trim())
    if (!/^https?:\/\//i.test(idOrUrl)) {
      const cached = await this.cacheService.getRecipe(`${selected.plugin.id}:${selected.order.id}`)
      if (cached && !options.refresh) return cached
    }
    const fetchUrl = selected.plugin.fetchUrl ?? selected.plugin.sourceUrl
    const response = await fetch(fetchUrl, {
      headers: { Accept: 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) {
      throw new Error(`Failed to fetch timeline source ${fetchUrl} (${response.status}: ${response.statusText}).`)
    }

    const responseBody = await response.text()
    const html = selected.plugin.responseHtmlPath
      ? this.readResponsePath(JSON.parse(responseBody), selected.plugin.responseHtmlPath, selected.plugin.id)
      : responseBody
    const document = new JSDOM(html).window.document
    const orderDefinition = selected.order.order
    const isListOrder = typeof orderDefinition !== 'string' && 'kind' in orderDefinition
    const rows = isListOrder
      ? this.parseListItems(document, selected.plugin, orderDefinition)
      : this.parseTableItems(document, selected.plugin, orderDefinition)

    const definition: TimelineDefinition = {
      id: `${selected.plugin.id}:${selected.order.id}`,
      franchise: selected.plugin.franchise,
      name: selected.order.name,
      description: `${selected.order.description} Source: ${selected.plugin.attribution}.`,
      sourceUrl: this.orderSourceUrl(selected.plugin, selected.order),
      version: isListOrder ? 1 : 2,
      granularity: isListOrder && orderDefinition.format !== 'star-trek-guide' ? 'series-blocks' : 'episode-interleaved',
      items: rows,
    }
    const validation = validateTimelineDefinition(definition)
    if (!validation.valid) throw new Error(`Parser '${selected.plugin.id}' produced an invalid timeline: ${validation.reason}.`)
    if (rows.length === 0) throw new Error(`Parser '${selected.plugin.id}' found no timeline items.`)
    await this.cacheService.setRecipe(definition.id, definition)
    return validation.value
  }

  private parseTableItems(
    document: Document,
    plugin: TimelineParserPlugin,
    orderDefinition: string | { groupingId: string; placement: 'first' | 'last' }
  ): TimelineItem[] {
    const table = [...document.querySelectorAll(plugin.tableSelector!)].find(candidate => {
      const header = candidate.querySelector(plugin.headerRowSelector!)
      const names = [...(header?.querySelectorAll('th,td') ?? [])].map(cell => this.readCellText(cell))
      return plugin.requiredHeaders!.every(name => names.includes(name))
    })
    if (!table) throw new Error(`Parser '${plugin.id}' found no table matching '${plugin.tableSelector}' and its required headers.`)
    const headerRow = table.querySelector(plugin.headerRowSelector!)!
    const headers = [...headerRow.querySelectorAll('th,td')].map(cell => this.readCellText(cell))
    const headerIndex = (name: string): number => {
      const index = headers.indexOf(name)
      if (index < 0) throw new Error(`Parser '${plugin.id}' could not find source column '${name}'.`)
      return index
    }
    const indexes: Record<string, number> = {}
    for (const [field, name] of Object.entries({
      title: plugin.fields!.title,
      type: plugin.fields!.type,
      seriesTitle: plugin.fields!.seriesTitle,
      broadcastNumber: plugin.fields!.broadcastNumber,
      seasonNumber: plugin.fields!.seasonNumber,
      episodeNumber: plugin.fields!.episodeNumber,
      airDate: plugin.fields!.airDate,
      timelineEra: plugin.fields!.timelineEra,
    })) {
      if (name) indexes[field] = headerIndex(name)
    }
    const isGroupedOrder = typeof orderDefinition !== 'string'
    const grouping = isGroupedOrder
      ? plugin.groupings.find(candidate => candidate.id === orderDefinition.groupingId)
      : undefined
    if (isGroupedOrder && !grouping) throw new Error(`Parser '${plugin.id}' has no grouping '${orderDefinition.groupingId}'.`)
    const orderIndex = isGroupedOrder ? -1 : headerIndex(orderDefinition)
    const groupOrders = isGroupedOrder ? this.readGroupOrders(document, plugin.id, grouping!) : undefined
    const tieBreakIndex = isGroupedOrder ? headerIndex(grouping!.tieBreakHeader) : -1

    return [...table.querySelectorAll(plugin.rowSelector!)]
        .filter(row => row !== headerRow)
        .flatMap((row, rowIndex) => {
        const cells = [...row.querySelectorAll(':scope > th, :scope > td')]
        const cell = (field: string): string | undefined => {
        const value = this.readCellText(cells[indexes[field]])
          return value || undefined
        }
        const title = cell('title')
        if (!title) return []
        const columnOrder = orderIndex >= 0 ? Number.parseFloat(this.readCellText(cells[orderIndex]) ?? '') : undefined
        const broadcast = cell('broadcastNumber')
        const seriesTitle = cell('seriesTitle') ?? this.seriesTitle(plugin, title)
        const orderValue = isGroupedOrder
          ? this.findGroupOrder(plugin, grouping!, orderDefinition.placement, title, broadcast, seriesTitle, groupOrders!)
          : columnOrder
        if (orderValue === undefined || !Number.isFinite(orderValue)) {
          throw new Error(`Parser '${plugin.id}' found no valid order for '${title}' in row ${rowIndex + 1}.`)
        }

        const coordinates = broadcast?.match(/^(\d+)\s*x\s*(\d+)$/i)
        const type = (plugin.fields!.fixedType ?? cell('type') ?? (plugin.fields!.broadcastNumber
          ? coordinates ? 'episode' : 'movie'
          : undefined))?.toLowerCase()
        if (type !== 'movie' && type !== 'episode') {
          throw new Error(`Parser '${plugin.id}' found unsupported item type '${type}' in row ${rowIndex + 1}.`)
        }
        const item: TimelineItem = {
          order: orderValue,
          type,
          title,
          identifiers: {},
        }
        const seasonNumber = coordinates ? Number.parseInt(coordinates[1], 10) : Number.parseInt(cell('seasonNumber') ?? '', 10)
        const episodeNumber = coordinates ? Number.parseInt(coordinates[2], 10) : Number.parseInt(cell('episodeNumber') ?? '', 10)
        if (seriesTitle && type === 'episode') item.seriesTitle = seriesTitle
        if (Number.isInteger(seasonNumber)) item.seasonNumber = seasonNumber
        if (Number.isInteger(episodeNumber)) item.episodeNumber = episodeNumber
        item.airDate = cell('airDate')
        item.timelineEra = cell('timelineEra')
        const tieBreak = isGroupedOrder ? Number.parseFloat(this.readCellText(cells[tieBreakIndex]) ?? '') : undefined
        if (isGroupedOrder && !Number.isFinite(tieBreak)) {
          throw new Error(`Parser '${plugin.id}' found no valid tie-break value for '${title}'.`)
        }
        return [{ item, tieBreak }]
        })
        .sort((left, right) => {
          const groupOrderDifference = left.item.order - right.item.order
          if (groupOrderDifference !== 0 || !isGroupedOrder) return groupOrderDifference
          return left.tieBreak! - right.tieBreak!
        })
        .map(({ item }, index) => ({ ...item, order: index + 1 }))
  }

  private parseListItems(
    document: Document,
    plugin: TimelineParserPlugin,
    config: TimelineParserListDefinition
  ): TimelineItem[] {
    const lists = [...document.querySelectorAll(config.listSelector)]
    if (config.listIndex !== undefined && !lists[config.listIndex]) {
      throw new Error(`Parser '${plugin.id}' found no list ${config.listIndex + 1} matching '${config.listSelector}'.`)
    }
    const selectedLists = config.listIndex === undefined ? lists : [lists[config.listIndex]]
    const elements = [...new Set(selectedLists.flatMap(list => [...list.querySelectorAll(config.itemSelector)]))]
    const items = elements.flatMap((element, elementIndex) => {
      const sourceText = this.readCellText(element)?.replace(/\u00a0/g, ' ').replace(/\*+\s*$/, '').trim() ?? ''
      if (!sourceText) return []
      if (config.excludedText.some(text => sourceText.toLowerCase().startsWith(text.toLowerCase()))) return []

      if (config.format === 'star-trek-guide') {
        const movie = sourceText.match(/^MOV\s+(.+)$/i)
        if (movie) return [this.listItem(elementIndex + 1, 'movie', movie[1].trim())]
        const episode = sourceText.match(/^([A-Z0-9]{2,6})\s+Season\s+(\d+),\s*episodes?\s+(\d+)(?:\s*[-–]\s*(\d+))?\s+-\s+(.+)$/i)
        if (!episode) throw new Error(`Parser '${plugin.id}' cannot parse source entry '${sourceText}'.`)
        const seriesTitle = config.seriesCodes[episode[1].toUpperCase()]
        if (!seriesTitle) throw new Error(`Parser '${plugin.id}' has no series mapping for '${episode[1]}'.`)
        const firstEpisode = Number(episode[3])
        const lastEpisode = Number(episode[4] ?? episode[3])
        if (lastEpisode < firstEpisode) throw new Error(`Parser '${plugin.id}' found a reversed episode range in '${sourceText}'.`)
        return Array.from({ length: lastEpisode - firstEpisode + 1 }, (_, index) => this.listItem(
          elementIndex + index + 1,
          'episode',
          episode[5].trim(),
          { seriesTitle, seasonNumber: Number(episode[2]), episodeNumber: firstEpisode + index }
        ))
      }

      const normalized = sourceText.toLowerCase()
      const anchor = element.matches('a') ? element : element.querySelector('a')
      const href = anchor?.getAttribute('href') ?? ''
      const textTypes = [
        ...config.showMarkers.filter(marker => normalized.includes(marker.toLowerCase())).map(() => 'show' as const),
        ...config.movieMarkers.filter(marker => normalized.includes(marker.toLowerCase())).map(() => 'movie' as const),
      ]
      const linkTypes = config.linkTypeRules.filter(rule => href.toLowerCase().includes(rule.contains.toLowerCase())).map(rule => rule.type)
      if (new Set(textTypes).size > 1 || new Set(linkTypes).size > 1) {
        throw new Error(`Parser '${plugin.id}' found conflicting item types for '${sourceText}'.`)
      }
      const type: 'movie' | 'show' | undefined = textTypes[0] ?? linkTypes[0] ?? config.defaultType
      if (!type) throw new Error(`Parser '${plugin.id}' cannot determine whether '${sourceText}' is a movie or series.`)

      let title = sourceText
      let timelineEra: string | undefined
      let releaseYear: number | undefined
      if (config.format === 'title-era-list') {
        const era = title.match(/:\s*(\d{3,4}(?:\s*,\s*[A-Za-z]+)?\s*(?:A\.D\.|B\.C\.|AD|BC)?)\s*$/i)
        if (era) {
          timelineEra = era[1]
          title = title.slice(0, era.index).trim()
        }
      } else {
        const era = title.match(/\s+\(([^()]*(?:\d{3,4}|BC|AD)[^()]*)\)\s*(?:\[[^\]]+\])?\s*$/i)
        if (era) {
          timelineEra = era[1].match(/\d{3,4}(?:\s*(?:B\.C\.|A\.D\.|BC|AD))?/i)?.[0] ?? era[1]
          const year = era[1].match(/(?:^|,\s*)(\d{4})(?:\s*[-–]\s*\d{4})?$/)
          if (year) releaseYear = Number(year[1])
          title = title.slice(0, era.index).trim()
        }
        title = title.replace(/\s*\(Episode\s+[IVXLCDM]+\)\s*$/i, '').trim()
      }
      title = title.replace(/\s*\[(?:Disney\s*Plus|Disney\+)\]\s*$/i, '').trim()
      for (const suffix of config.removeSuffixes) {
        if (title.toLowerCase().endsWith(suffix.toLowerCase())) title = title.slice(0, -suffix.length).trim()
      }
      const seasonRule = type === 'show' && config.showSeasonRules.find(rule => this.normalize(rule.title) === this.normalize(title))
      const itemTitle = seasonRule ? `${title} Season ${seasonRule.season}` : title
      const item: TimelineItem = this.listItem(elementIndex + 1, type, itemTitle)
      if (timelineEra) item.timelineEra = timelineEra
      if (releaseYear) item.releaseYear = releaseYear
      if (type === 'show') {
        item.seriesTitle = itemTitle.replace(/\s+seasons?\s+\d+.*$/i, '').trim()
      }
      return [item]
    })

    if (items.length < config.minimumItems) {
      throw new Error(`Parser '${plugin.id}' found ${items.length} items; its source must provide at least ${config.minimumItems}.`)
    }
    for (const split of config.showSeasonSplits) {
      const series = this.normalize(split.seriesTitle)
      const showIndex = items.findIndex(item => item.type === 'show' && this.normalize(item.seriesTitle ?? item.title) === series)
      if (showIndex < 0) throw new Error(`Parser '${plugin.id}' found no series entry for configured split '${split.seriesTitle}'.`)
      const anchorIndex = items.findIndex(item => this.normalize(item.title) === this.normalize(split.afterTitle))
      if (anchorIndex < 0) throw new Error(`Parser '${plugin.id}' found no placement title '${split.afterTitle}'.`)
      const show = items[showIndex]
      const splitShows = split.seasons.map(seasonNumber => ({
        ...show,
        title: `${split.seriesTitle} Season ${seasonNumber}`,
        seriesTitle: split.seriesTitle,
      }))
      items.splice(showIndex, 1, splitShows[0])
      const adjustedAnchorIndex = items.findIndex((item, index) => index !== showIndex && this.normalize(item.title) === this.normalize(split.afterTitle))
      items.splice(adjustedAnchorIndex + 1, 0, ...splitShows.slice(1))
    }
    return items.map((item, index) => ({ ...item, order: index + 1 }))
  }

  private listItem(
    order: number,
    type: TimelineItem['type'],
    title: string,
    episode?: Pick<TimelineItem, 'seriesTitle' | 'seasonNumber' | 'episodeNumber'>
  ): TimelineItem {
    return { order, type, title, ...episode, identifiers: {} }
  }

  async savePlugin(value: unknown): Promise<TimelineParserPlugin[]> {
    const plugin = TimelineParserPluginSchema.parse(value)
    const previous = (await this.readPlugins()).find(existing => existing.id === plugin.id)
    const saved = await this.readSavedPlugins()
    const updated = [...saved.filter(existing => existing.id !== plugin.id), plugin]
    await getDatabase().config.setSetting(SETTING_KEY, JSON.stringify(updated))
    for (const order of [...(previous?.orders ?? []), ...plugin.orders]) {
      await this.cacheService.invalidate(`${plugin.id}:${order.id}`)
    }
    return await this.readPlugins()
  }

  async removePlugin(id: string): Promise<TimelineParserPlugin[]> {
    const removed = (await this.readPlugins()).find(plugin => plugin.id === id)
    const plugins = (await this.readSavedPlugins()).filter(plugin => plugin.id !== id)
    await getDatabase().config.setSetting(SETTING_KEY, JSON.stringify(plugins))
    for (const order of removed?.orders ?? []) await this.cacheService.invalidate(`${id}:${order.id}`)
    return await this.readPlugins()
  }

  async listPlugins(): Promise<TimelineParserPlugin[]> {
    return await this.readPlugins()
  }

  async supports(idOrUrl: string): Promise<boolean> {
    const input = idOrUrl.trim()
    const plugins = await this.readPlugins()
    if (plugins.some(plugin => input.startsWith(`${plugin.id}:`))) return true
    if (!/^https?:\/\//i.test(input)) return false
    const inputUrl = new URL(input)
    const matches = plugins.filter(plugin => {
      const sourceUrl = new URL(plugin.sourceUrl)
      return inputUrl.origin === sourceUrl.origin && inputUrl.pathname === sourceUrl.pathname
    })
    if (matches.length > 1) throw new Error(`Multiple timeline parser definitions match '${input}'.`)
    return matches.length === 1
  }

  private async findOrder(idOrUrl: string): Promise<TimelineParserOrder> {
    for (const plugin of await this.readPlugins()) {
      const order = plugin.orders.find(candidate => `${plugin.id}:${candidate.id}` === idOrUrl)
      if (order) return { plugin, order }
      if (/^https?:\/\//i.test(idOrUrl)) {
        const inputUrl = new URL(idOrUrl)
        const sourceUrl = new URL(plugin.sourceUrl)
        if (inputUrl.origin === sourceUrl.origin && inputUrl.pathname === sourceUrl.pathname) {
          const requestedOrder = inputUrl.searchParams.get('timelineOrder')
          const selectedOrder = requestedOrder
            ? plugin.orders.find(candidate => candidate.id === requestedOrder)
            : plugin.orders.length === 1 ? plugin.orders[0] : undefined
          if (!selectedOrder) throw new Error(`Choose one of parser '${plugin.id}' viewing orders before importing its source.`)
          return { plugin, order: selectedOrder }
        }
      }
    }
    throw new Error(`No saved timeline parser matches '${idOrUrl}'. Add a parser definition for this source first.`)
  }

  private readGroupOrders(
    document: Document,
    pluginId: string,
    config: TimelineParserGroupDefinition
  ): Map<string, number[]> {
    const table = [...document.querySelectorAll(config.groupTableSelector)].find(candidate => {
      const row = candidate.querySelector(config.groupHeaderRowSelector)
      const names = [...(row?.querySelectorAll('th,td') ?? [])].map(cell => this.readCellText(cell))
      return names.includes(config.groupHeader) && names.includes(config.groupOrderHeader)
    })
    if (!table) throw new Error(`Parser '${pluginId}' found no group table matching its configured headers.`)
    const header = table.querySelector(config.groupHeaderRowSelector)!
    const headers = [...header.querySelectorAll('th,td')].map(cell => this.readCellText(cell))
    const groupIndex = headers.indexOf(config.groupHeader)
    const orderIndex = headers.indexOf(config.groupOrderHeader)
    if (groupIndex < 0 || orderIndex < 0) throw new Error(`Parser '${pluginId}' group table is missing a configured header.`)
    const groups = new Map<string, number[]>()
    for (const row of table.querySelectorAll(config.groupRowSelector)) {
      if (row === header) continue
      const cells = [...row.querySelectorAll(':scope > th, :scope > td')]
      const name = this.normalize(this.readCellText(cells[groupIndex]) ?? '')
      const placements = this.readCellText(cells[orderIndex])?.match(/\d+(?:\.\d+)?/g)?.map(Number) ?? []
      if (name && placements.length) groups.set(name, placements)
    }
    return groups
  }

  private findGroupOrder(
    plugin: TimelineParserPlugin,
    config: TimelineParserGroupDefinition,
    placement: 'first' | 'last',
    title: string,
    broadcastNumber: string | undefined,
    seriesTitle: string,
    groups: Map<string, number[]>
  ): number | undefined {
    const coordinates = broadcastNumber?.match(/^(\d+)\s*x\s*(\d+)$/i)
    const assignment = coordinates
      ? config.assignments.find(rule => rule.kind === 'episode-range' && rule.seriesTitle === seriesTitle &&
        rule.seasonNumber === Number(coordinates[1]) && Number(coordinates[2]) >= rule.firstEpisode && Number(coordinates[2]) <= rule.lastEpisode)
      : config.assignments.find(rule => rule.kind === 'movie-title' &&
        (this.normalize(rule.title) === this.normalize(title) || this.normalize(title).endsWith(` ${this.normalize(rule.title)}`)))
    if (!assignment) throw new Error(`Parser '${plugin.id}' has no group assignment for '${title}'.`)
    const placements = groups.get(this.normalize(assignment.group))
    if (!placements) throw new Error(`Parser '${plugin.id}' source has no group placement for '${assignment.group}'.`)
    return placement === 'first' ? placements[0] : placements[placements.length - 1]
  }

  private seriesTitle(plugin: TimelineParserPlugin, title: string): string {
    const prefix = plugin.episodeSeries?.titlePrefixes.find(rule => title.startsWith(rule.prefix))
    return prefix?.seriesTitle ?? plugin.episodeSeries?.default ?? ''
  }

  private normalize(value: string): string {
    return normalizeMediaTitle(value)
  }

  private readCellText(cell?: Element): string | undefined {
    if (!cell) return undefined
    const content = cell.cloneNode(true) as Element
    content.querySelectorAll('sup').forEach(note => note.remove())
    return content.textContent?.replace(/\s+/g, ' ').trim() || undefined
  }

  private orderSourceUrl(plugin: TimelineParserPlugin, order: TimelineParserPlugin['orders'][number]): string {
    const sourceUrl = new URL(plugin.sourceUrl)
    if (plugin.orders.length > 1) sourceUrl.searchParams.set('timelineOrder', order.id)
    return sourceUrl.toString()
  }

  private readResponsePath(value: unknown, path: string, pluginId: string): string {
    let current: unknown = value
    for (const key of path.split('.')) {
      if (typeof current !== 'object' || current === null || !(key in current)) {
        throw new Error(`Parser '${pluginId}' response is missing configured HTML path '${path}'.`)
      }
      current = (current as Record<string, unknown>)[key]
    }
    if (typeof current !== 'string') throw new Error(`Parser '${pluginId}' response path '${path}' is not text.`)
    return current
  }

  private async readPlugins(): Promise<TimelineParserPlugin[]> {
    const saved = await this.readSavedPlugins()
    const plugins = new Map(BUILT_IN_PLUGINS.map(plugin => [plugin.id, plugin]))
    for (const plugin of saved) plugins.set(plugin.id, plugin)
    return [...plugins.values()]
  }

  private async readSavedPlugins(): Promise<TimelineParserPlugin[]> {
    const raw = await getDatabase().config.getSetting(SETTING_KEY)
    if (!raw) return []
    const values: unknown = JSON.parse(raw)
    if (!Array.isArray(values)) throw new Error(`Setting '${SETTING_KEY}' must contain an array of parser definitions.`)
    return values.map(value => TimelineParserPluginSchema.parse(value))
  }
}
