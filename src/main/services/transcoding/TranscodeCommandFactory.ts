import type { ITranscodeCommandBuilder, TranscodeOptions } from './types'
import { NvidiaCommandBuilder } from './NvidiaCommandBuilder'
import { IntelCommandBuilder } from './IntelCommandBuilder'
import { SoftwareCommandBuilder } from './SoftwareCommandBuilder'
import { StreamRemuxCommandBuilder } from './StreamRemuxCommandBuilder'

export class TranscodeCommandFactory {
  private static readonly GPU_BUILDERS: Record<string, () => ITranscodeCommandBuilder> = {
    'NVIDIA': () => new NvidiaCommandBuilder(),
    'Intel': () => new IntelCommandBuilder(),
  }

  static resolveOutputMode(requestedOutputMode: NonNullable<TranscodeOptions['outputMode']>): NonNullable<TranscodeOptions['outputMode']> {
    return requestedOutputMode
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
