import { ITranscodeCommandBuilder } from './types'
import { NvidiaCommandBuilder } from './NvidiaCommandBuilder'
import { IntelCommandBuilder } from './IntelCommandBuilder'
import { SoftwareCommandBuilder } from './SoftwareCommandBuilder'
import { StreamRemuxCommandBuilder } from './StreamRemuxCommandBuilder'
import { TranscodeOptions } from '../TranscodingService'

export class TranscodeCommandFactory {
  private static readonly GPU_BUILDERS: Record<string, () => ITranscodeCommandBuilder> = {
    'NVIDIA': () => new NvidiaCommandBuilder(),
    'Intel': () => new IntelCommandBuilder(),
  }

  static resolveOutputMode(
    requestedOutputMode: TranscodeOptions['outputMode'] | null | undefined,
    encoder: string | undefined,
    hasCustomArgs = false
  ): NonNullable<TranscodeOptions['outputMode']> {
    if (!requestedOutputMode) throw new Error('Transcode output mode must be explicitly selected.')
    const outputMode = requestedOutputMode
    if (encoder === 'copy' && !hasCustomArgs) return outputMode
    if (outputMode === 'replace') return 'quarantine-replace'
    if (outputMode === 'copy') throw new Error('Copy output mode requires a stream-remux encoder without custom arguments.')
    return outputMode
  }

  static getBuilder(vendor?: string, options: TranscodeOptions = {}): ITranscodeCommandBuilder {
    if (options.optimizationMode === 'remux_only' || options.encoder === 'remux' || options.encoder === 'copy') {
      return new StreamRemuxCommandBuilder()
    }
    const isGpuRequested = Boolean(options.useGpu || options.gpuId)
    if (isGpuRequested) {
      if (!vendor || vendor === 'Unknown' || vendor === 'software') {
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
