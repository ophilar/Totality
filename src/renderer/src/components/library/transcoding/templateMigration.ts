import { TranscodeOptionsSchema } from '@main/validation/schemas'
import type { PresetTemplate } from './types'

export function migrateTemplateOptions(value: unknown): { options: unknown; changed: boolean } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { options: value, changed: false }
  const options = { ...(value as Record<string, unknown>) }
  if (options.qualityProfile === 'lossless') {
    options.qualityProfile = 'transparent'
    return { options, changed: true }
  }
  if (options.qualityProfile === 'efficiency') {
    options.qualityProfile = 'maximum_savings'
    return { options, changed: true }
  }
  return { options, changed: false }
}

export function readTemplates(value: unknown): { templates: PresetTemplate[]; migrated: boolean } {
  if (!Array.isArray(value)) throw new Error('Saved templates must be a list')
  let migrated = false
  const templates = value.map((entry, index): PresetTemplate => {
    if (!entry || typeof entry !== 'object' || typeof entry.name !== 'string' || !entry.name.trim() || !('options' in entry)) {
      throw new Error(`Saved template ${index + 1} has an invalid name or options field`)
    }
    const migration = migrateTemplateOptions(entry.options)
    migrated ||= migration.changed
    const result = TranscodeOptionsSchema.unwrap().safeParse(migration.options)
    return result.success
      ? { name: entry.name, options: result.data }
      : {
          name: entry.name,
          options: migration.options,
          error: `Template "${entry.name}" has an unsupported setting${result.error.issues[0]?.path.length ? ` for ${result.error.issues[0].path.join('.')}` : ''}. Reselect that option before using the template.`,
        }
  })
  return { templates, migrated }
}
