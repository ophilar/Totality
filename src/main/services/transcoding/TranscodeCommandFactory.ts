import { ITranscodeCommandBuilder } from './types'
import { NvidiaCommandBuilder } from './NvidiaCommandBuilder'
import { IntelCommandBuilder } from './IntelCommandBuilder'
import { SoftwareCommandBuilder } from './SoftwareCommandBuilder'
import { TranscodeOptions } from '../TranscodingService'

export class TranscodeCommandFactory {
  static getBuilder(vendor?: string, options: TranscodeOptions = {}): ITranscodeCommandBuilder {
    if (options.useGpu || options.gpuId) {
      if (vendor === 'NVIDIA') return new NvidiaCommandBuilder()
      if (vendor === 'Intel') return new IntelCommandBuilder()
    }
    return new SoftwareCommandBuilder()
  }
}
