
import type { ITranscodeCommandBuilder, TranscodeOptions } from './types'
import type { FileAnalysisResult } from '../MediaFileAnalyzer'
import { NvidiaCommandBuilder } from './NvidiaCommandBuilder'
import { IntelCommandBuilder } from './IntelCommandBuilder'
import { AmdCommandBuilder } from './AmdCommandBuilder'
import { AppleCommandBuilder } from './AppleCommandBuilder'
import { SoftwareCommandBuilder } from './SoftwareCommandBuilder'
import { StreamRemuxCommandBuilder } from './StreamRemuxCommandBuilder'

export class TranscodeCommandFactory {
  private static readonly GPU_BUILDERS: Record<string, () => ITranscodeCommandBuilder> = {
    'NVIDIA': () => new NvidiaCommandBuilder(),
    'Intel': () => new IntelCommandBuilder(),
    'AMD': () => new AmdCommandBuilder(),
    'Apple': () => new AppleCommandBuilder(),
  }

  static resolveOutputMode(
    requestedOutputMode: TranscodeOptions['outputMode'] | null | undefined,
    _encoder?: string,
    _hasCustomArgs = false
  ): NonNullable<TranscodeOptions['outputMode']> {
    if (!requestedOutputMode) throw new Error('Transcode output mode must be explicitly selected.')
    return requestedOutputMode
  }

  /** Build the exact reviewed command using the actual container extension. */
  static buildCommandTemplate(vendor: string | undefined, options: TranscodeOptions, analysis: FileAnalysisResult, outputExtension: string): string[] {
    const output = `<output>${outputExtension}`
    const args = this.getBuilder(vendor, options).buildFFmpegArgs('<input>', output, options, analysis)
    if (args.at(-1) !== output) throw new Error('Transcode command did not identify its output')
    args[args.length - 1] = '<output>'
    const customArgs = options.customArgs?.trim()
    if (customArgs) {
      const parts = customArgs.match(/"[^"]*"|'[^']*'|\S+/g) ?? []
      const safeRegex = /^[a-zA-Z0-9\-_+=/\\:,.*"'\s]+$/
      const cleaned = parts.map(part => part.replace(/^["']|["']$/g, '').trim())
      if (cleaned.some(part => !part || !safeRegex.test(part))) throw new Error('Custom FFmpeg arguments contain an unsupported token')
      // The measured workflow must retain its generated encoder, mapping, timing and filter semantics.
      // Only output metadata and muxer queue options have no effect on those planned parameters.
      if (options.optimizationMode !== 'remux_only' && options.encoder !== 'remux' && options.encoder !== 'copy') {
        for (let index = 0; index < cleaned.length; index += 2) {
          const flag = cleaned[index]
          const value = cleaned[index + 1]
          if (!/^-(?:metadata(?::[a-zA-Z0-9:]+)?|max_muxing_queue_size|muxing_queue_data_threshold)$/.test(flag) || value === undefined || value.startsWith('-')) {
            throw new Error(`Custom FFmpeg option ${flag} is not supported by measured optimization; use the explicit optimization settings`)
          }
        }
      }
      args.splice(args.length - 1, 0, ...cleaned)
    }
    return args
  }

  static getBuilder(vendor?: string, options: TranscodeOptions = {}): ITranscodeCommandBuilder {
    if (options.optimizationMode === 'remux_only' || options.encoder === 'remux' || options.encoder === 'copy') {
      return new StreamRemuxCommandBuilder()
    }
    const isGpuRequested = Boolean(options.useGpu || options.gpuId)
    if (isGpuRequested) {
      if (!vendor || vendor === 'Unknown' || vendor === 'Software') {
        throw new Error('GPU transcoding was requested, but no valid GPU vendor was provided.')
      }
      const builderFactory = this.GPU_BUILDERS[vendor]
      if (!builderFactory) {
        throw new Error(`GPU transcoding is not supported for vendor: "${vendor}". Supported hardware transcoding vendors: ${Object.keys(this.GPU_BUILDERS).join(', ')}.`)
      }
      return builderFactory()
    }
    return new SoftwareCommandBuilder()
  }
}
