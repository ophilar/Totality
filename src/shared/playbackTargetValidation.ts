import { z } from 'zod'

const capabilityTokenSchema = z.string().trim().min(1)

export const playbackTargetDefinitionSchema = z.object({
  containers: z.array(capabilityTokenSchema).min(1),
  video: z.object({
    codecs: z.array(capabilityTokenSchema).min(1), profiles: z.array(capabilityTokenSchema).min(1), levels: z.array(z.number().positive()).min(1),
    maxWidth: z.number().positive(), maxHeight: z.number().positive(), maxFrameRate: z.number().positive(), bitDepths: z.array(z.number().positive()).min(1),
    containerRules: z.array(z.object({ containers: z.array(capabilityTokenSchema).min(1), codecs: z.array(capabilityTokenSchema).optional(), profiles: z.array(capabilityTokenSchema).optional(), hdrFormats: z.array(capabilityTokenSchema).optional() })).optional(),
  }),
  hdr: z.object({ formats: z.array(capabilityTokenSchema), fallbackRequired: z.boolean() }),
  audio: z.object({ codecs: z.array(capabilityTokenSchema).min(1), maxChannels: z.number().positive(), objectAudio: z.boolean(), outputPath: z.enum(['device', 'passthrough', 'receiver']) }),
  subtitles: z.object({ formats: z.array(capabilityTokenSchema), embedded: z.boolean(), external: z.boolean(), burnIn: z.boolean() }),
  network: z.object({ sustainableBitrate: z.number().positive() }),
  providers: z.object({ plex: z.object({ clientProduct: z.string().min(1), clientPlatform: z.string().min(1), clientVersion: z.string().min(1) }).optional() }).optional(),
})

export const playbackTargetProfileInputSchema = z.object({ name: z.string().trim().min(1), definition: playbackTargetDefinitionSchema })
