import { ITranscodeCommandBuilder } from './types'
import { NvidiaCommandBuilder } from './NvidiaCommandBuilder'
import { IntelCommandBuilder } from './IntelCommandBuilder'
import { SoftwareCommandBuilder } from './SoftwareCommandBuilder'
import { StreamRemuxCommandBuilder } from './StreamRemuxCommandBuilder'
import { TranscodeOptions } from '../TranscodingService'

export class TranscodeCommandFactory {
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
    if (options.useGpu || options.gpuId) {
      if (vendor === 'NVIDIA') return new NvidiaCommandBuilder()
      if (vendor === 'Intel') return new IntelCommandBuilder()
    }
    return new SoftwareCommandBuilder()
  }
}
