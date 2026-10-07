import { z } from 'zod'

const HeaderSchema = z.string().trim().min(1)
const TimelineParserListSchema = z.object({
  kind: z.literal('list'),
  listSelector: z.string().trim().min(1),
  itemSelector: z.string().trim().min(1),
  listIndex: z.number().int().nonnegative().optional(),
  format: z.enum(['star-trek-guide', 'title-list', 'title-era-list']),
  minimumItems: z.number().int().positive(),
  excludedText: z.array(z.string().trim().min(1)).default([]),
  removeSuffixes: z.array(z.string().trim().min(1)).default([]),
  defaultType: z.enum(['movie', 'show']).optional(),
  showMarkers: z.array(z.string().trim().min(1)).default([]),
  movieMarkers: z.array(z.string().trim().min(1)).default([]),
  linkTypeRules: z.array(z.object({ contains: z.string().trim().min(1), type: z.enum(['movie', 'show']) })).default([]),
  showSeasonSplits: z.array(z.object({
    seriesTitle: z.string().trim().min(1),
    seasons: z.array(z.number().int().positive()).min(2),
    afterTitle: z.string().trim().min(1),
  })).default([]),
  showSeasonRules: z.array(z.object({ title: z.string().trim().min(1), season: z.number().int().positive() })).default([]),
  seriesCodes: z.record(z.string(), z.string().trim().min(1)).default({}),
})

export const TimelineParserPluginSchema = z.object({
  id: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().trim().min(1),
  franchise: z.string().trim().min(1),
  description: z.string(),
  sourceUrl: z.string().url(),
  fetchUrl: z.string().url().optional(),
  responseHtmlPath: z.string().trim().min(1).optional(),
  attribution: z.string().trim().min(1),
  tableSelector: z.string().trim().min(1).optional(),
  headerRowSelector: z.string().trim().min(1).optional(),
  rowSelector: z.string().trim().min(1).optional(),
  requiredHeaders: z.array(HeaderSchema).min(1).optional(),
  fields: z.object({
    title: HeaderSchema,
    type: HeaderSchema.optional(),
    fixedType: z.enum(['movie', 'episode']).optional(),
    seriesTitle: HeaderSchema.optional(),
    broadcastNumber: HeaderSchema.optional(),
    seasonNumber: HeaderSchema.optional(),
    episodeNumber: HeaderSchema.optional(),
    airDate: HeaderSchema.optional(),
    timelineEra: HeaderSchema.optional(),
  }).refine(fields => Boolean(fields.type || fields.fixedType || fields.broadcastNumber), 'fields.type, fields.fixedType, or fields.broadcastNumber is required').optional(),
  episodeSeries: z.object({
    default: z.string().trim().min(1),
    titlePrefixes: z.array(z.object({ prefix: z.string().trim().min(1), seriesTitle: z.string().trim().min(1) })),
  }).optional(),
  groupings: z.array(z.object({
    id: z.string().trim().min(1),
    groupTableSelector: z.string().trim().min(1),
    groupHeaderRowSelector: z.string().trim().min(1),
    groupRowSelector: z.string().trim().min(1),
    groupHeader: HeaderSchema,
    groupOrderHeader: HeaderSchema,
    tieBreakHeader: HeaderSchema,
    assignments: z.array(z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('episode-range'), seriesTitle: z.string().trim().min(1), seasonNumber: z.number().int().nonnegative(), firstEpisode: z.number().int().positive(), lastEpisode: z.number().int().positive(), group: z.string().trim().min(1) }),
      z.object({ kind: z.literal('movie-title'), title: z.string().trim().min(1), group: z.string().trim().min(1) }),
    ])).min(1),
  })),
  orders: z.array(z.object({
    id: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    name: z.string().trim().min(1),
    description: z.string(),
    order: z.union([
      HeaderSchema,
      TimelineParserListSchema,
      z.object({ groupingId: z.string().trim().min(1), placement: z.enum(['first', 'last']) }),
    ]),
  })).min(1),
}).superRefine((plugin, context) => {
  const ids = new Set<string>()
  for (const order of plugin.orders) {
    if (ids.has(order.id)) context.addIssue({ code: 'custom', path: ['orders'], message: `Duplicate order id '${order.id}'.` })
    ids.add(order.id)
  }
  const requiresTable = plugin.orders.some(order => typeof order.order === 'string' || 'groupingId' in order.order)
  if (requiresTable && (!plugin.tableSelector || !plugin.headerRowSelector || !plugin.rowSelector || !plugin.requiredHeaders || !plugin.fields)) {
    context.addIssue({ code: 'custom', path: ['orders'], message: 'Table and grouped orders require table selectors, required headers, and field mappings.' })
  }
  const fields = plugin.fields
  if (fields && (fields.fixedType === 'episode' || fields.broadcastNumber) &&
      ((!fields.seriesTitle && !plugin.episodeSeries) ||
        (!fields.broadcastNumber && (!fields.seasonNumber || !fields.episodeNumber)))) {
    context.addIssue({ code: 'custom', path: ['fields'], message: 'Episode parsers require a series title and episode coordinates.' })
  }
})

export type TimelineParserPlugin = z.infer<typeof TimelineParserPluginSchema>
export type TimelineParserPluginInput = z.input<typeof TimelineParserPluginSchema>
export type TimelineParserGroupDefinition = TimelineParserPlugin['groupings'][number]
export type TimelineParserListDefinition = Extract<TimelineParserPlugin['orders'][number]['order'], { kind: 'list' }>

export interface TimelineParserOrder {
  plugin: TimelineParserPlugin
  order: TimelineParserPlugin['orders'][number]
}
