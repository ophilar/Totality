import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { ITimelineRecipeProvider, TimelineDefinition, TimelineRecipeSummary } from './ITimelineRecipeProvider'
import { validateTimelineDefinition } from './TimelineValidation'

export class LocalTimelineRecipeProvider implements ITimelineRecipeProvider {
  constructor(private readonly directory: string) {}

  async listAvailableRecipes(): Promise<TimelineRecipeSummary[]> {
    const entries = await this.readFiles()
    return entries.map(({ recipe }) => ({
      id: recipe.id,
      name: recipe.name,
      franchise: recipe.franchise,
      description: recipe.description,
      totalItems: recipe.items.length,
      sourceType: 'preset' as const,
    }))
  }

  async fetchTimeline(id: string): Promise<TimelineDefinition> {
    const filename = `${id}.json`
    const entries = await this.readFiles()
    const entry = entries.find(({ name }) => name === filename)
    if (!entry) throw new Error(`Timeline '${id}' was not found in ${this.directory}.`)
    return entry.recipe
  }

  private async readFiles(): Promise<Array<{ name: string; recipe: TimelineDefinition }>> {
    let names: string[]
    try {
      names = (await fs.readdir(this.directory, { withFileTypes: true }))
        .filter(entry => entry.isFile() && path.extname(entry.name).toLowerCase() === '.json')
        .map(entry => entry.name)
        .sort()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }

    const results: Array<{ name: string; recipe: TimelineDefinition }> = []
    for (const name of names) {
      const filename = path.join(this.directory, name)
      let value: unknown
      try {
        value = JSON.parse(await fs.readFile(filename, 'utf8'))
      } catch (error) {
        throw new Error(`Timeline file '${filename}' is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
      }
      const validation = validateTimelineDefinition(value)
      if (!validation.valid) throw new Error(`Timeline file '${filename}' is invalid: ${validation.reason}`)
      results.push({ name, recipe: validation.value })
    }
    return results
  }
}
