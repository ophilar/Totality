import { describe, it, expect } from 'vitest'
import { TrashSourceClassifier } from '../../../../src/main/services/transcoding/TrashSourceClassifier'

describe('TrashSourceClassifier', () => {
  describe('Filename pattern matching', () => {
    it('correctly classifies Remux releases', () => {
      expect(TrashSourceClassifier.classify('The.Matrix.1999.UHD.Remux.2160p.HEVC.mkv')).toBe('Remux')
      expect(TrashSourceClassifier.classify('Inception.2010.BDRemux.1080p.AVC.mkv')).toBe('Remux')
      expect(TrashSourceClassifier.classify('Avatar.2009.UHD_Remux.2160p.mkv')).toBe('Remux')
      expect(TrashSourceClassifier.classify('Interstellar.2014.UHD-Remux.mkv')).toBe('Remux')
      expect(TrashSourceClassifier.classify('/media/remux/movies/generic_video.mkv')).toBe('Remux')
    })

    it('correctly classifies WEBRip releases and gives precedence over generic web tokens', () => {
      expect(TrashSourceClassifier.classify('Ted.Lasso.S01E01.WEBRip.1080p.x264.mkv')).toBe('WEBRip')
      expect(TrashSourceClassifier.classify('The.Bear.S02E01.1080p.WEB-Rip.AAC.mkv')).toBe('WEBRip')
      expect(TrashSourceClassifier.classify('Severance.S01E01.2160p.webrip.x265.mkv')).toBe('WEBRip')
      expect(TrashSourceClassifier.classify('Movie.2023.AMZN.WEBRip.1080p.mkv')).toBe('WEBRip')
    })

    it('correctly classifies WEB-DL releases and streaming service tags', () => {
      expect(TrashSourceClassifier.classify('Stranger.Things.S04E01.WEB-DL.2160p.NF.mkv')).toBe('WEB-DL')
      expect(TrashSourceClassifier.classify('House.of.the.Dragon.S01E01.2160p.HMAX.WEB-DL.DDP5.1.Atmos.H.265-FLUX.mkv')).toBe('WEB-DL')
      expect(TrashSourceClassifier.classify('The.Mandalorian.S03E01.2160p.DSNP.WEB-DL.DDP5.1.Atmos.H.265.mkv')).toBe('WEB-DL')
      expect(TrashSourceClassifier.classify('Foundation.S02E01.1080p.ATVP.webdl.mkv')).toBe('WEB-DL')
      expect(TrashSourceClassifier.classify('The.Boys.S04E01.1080p.AMZN.web.mkv')).toBe('WEB-DL')
      expect(TrashSourceClassifier.classify('Loki.S02E01.1080p.Disney.mkv')).toBe('WEB-DL')
      expect(TrashSourceClassifier.classify('Succession.S04E01.1080p.MAX.mkv')).toBe('WEB-DL')
      expect(TrashSourceClassifier.classify('Ted.Lasso.S03E01.1080p.iTunes.mkv')).toBe('WEB-DL')
    })

    it('correctly classifies BluRay / BDRip / BRRip releases', () => {
      expect(TrashSourceClassifier.classify('Gladiator.2000.BluRay.1080p.DTS-HD.MA.5.1.x264.mkv')).toBe('BluRay')
      expect(TrashSourceClassifier.classify('Oppenheimer.2023.Blu-Ray.2160p.x265.mkv')).toBe('BluRay')
      expect(TrashSourceClassifier.classify('Dune.2021.1080p.BDRip.x264.mkv')).toBe('BluRay')
      expect(TrashSourceClassifier.classify('Top.Gun.Maverick.2022.BRRip.x264.mkv')).toBe('BluRay')
      expect(TrashSourceClassifier.classify('Blade.Runner.2049.2017.BDR.x264.mkv')).toBe('BluRay')
    })

    it('correctly prioritizes Remux over BluRay when both are present', () => {
      expect(TrashSourceClassifier.classify('Movie.2021.BluRay.Remux.1080p.mkv')).toBe('Remux')
      expect(TrashSourceClassifier.classify('Show.S01E01.UHD.Remux.Blu-Ray.mkv')).toBe('Remux')
    })

    it('correctly classifies HDTV and capture releases', () => {
      expect(TrashSourceClassifier.classify('Formula1.2024.Race.HDTV.720p.mkv')).toBe('HDTV')
      expect(TrashSourceClassifier.classify('BBC.News.2024.PDTV.x264.mkv')).toBe('HDTV')
      expect(TrashSourceClassifier.classify('Concert.2023.DSR.mkv')).toBe('HDTV')
    })

    it('correctly classifies SDTV / DVD releases', () => {
      expect(TrashSourceClassifier.classify('OldShow.S01E01.DVDRip.xvid.avi')).toBe('SDTV')
      expect(TrashSourceClassifier.classify('VintageClassic.1985.DVD.iso')).toBe('SDTV')
      expect(TrashSourceClassifier.classify('Sitcom.1990.SDTV.mkv')).toBe('SDTV')
    })
  })

  describe('Stream characteristics heuristic fallback', () => {
    it('infers Remux for high-bitrate (>25 Mbps) AVC/VC1/MPEG2 streams', () => {
      expect(TrashSourceClassifier.classify('unnamed_video.mkv', 35000, 'h264')).toBe('Remux')
      expect(TrashSourceClassifier.classify('unnamed_video.mkv', 28000, 'avc')).toBe('Remux')
      expect(TrashSourceClassifier.classify('unnamed_video.mkv', 30000, 'vc1')).toBe('Remux')
      expect(TrashSourceClassifier.classify('unnamed_video.mkv', 26000, 'mpeg2video')).toBe('Remux')
      expect(TrashSourceClassifier.classify('unnamed_video.mkv', 26000, 'MPEG2')).toBe('Remux')
    })

    it('infers BluRay for high-bitrate (>14 Mbps) or non-legacy high-bitrate codecs', () => {
      expect(TrashSourceClassifier.classify('unnamed_video.mkv', 26000, 'hevc')).toBe('BluRay')
      expect(TrashSourceClassifier.classify('unnamed_video.mkv', 18000, 'h264')).toBe('BluRay')
      expect(TrashSourceClassifier.classify('unnamed_video.mkv', 15000, 'avc')).toBe('BluRay')
    })

    it('infers WEB-DL for moderate/low-bitrate (>0 Mbps) streams', () => {
      expect(TrashSourceClassifier.classify('unnamed_video.mkv', 8000, 'hevc')).toBe('WEB-DL')
      expect(TrashSourceClassifier.classify('unnamed_video.mkv', 3500, 'h264')).toBe('WEB-DL')
      expect(TrashSourceClassifier.classify('unnamed_video.mkv', 1200, 'av1')).toBe('WEB-DL')
    })

    it('returns Unknown when no release tag and no bitrate is provided', () => {
      expect(TrashSourceClassifier.classify('unnamed_video.mkv')).toBe('Unknown')
      expect(TrashSourceClassifier.classify('unnamed_video.mkv', 0)).toBe('Unknown')
      expect(TrashSourceClassifier.classify('', 0)).toBe('Unknown')
      expect(TrashSourceClassifier.classify('')).toBe('Unknown')
    })
  })

  describe('Edge cases and delimiters', () => {
    it('handles underscores, periods, hyphens and space delimiters', () => {
      expect(TrashSourceClassifier.classify('Movie_Name_remux_1080p.mkv')).toBe('Remux')
      expect(TrashSourceClassifier.classify('Show Name - S01E01 - WEB-DL 1080p.mkv')).toBe('WEB-DL')
      expect(TrashSourceClassifier.classify('Series_S01E01_bluray_720p.mkv')).toBe('BluRay')
    })

    it('is case insensitive across all tiers', () => {
      expect(TrashSourceClassifier.classify('movie.bLuRaY.mkv')).toBe('BluRay')
      expect(TrashSourceClassifier.classify('show.wEb-Dl.mkv')).toBe('WEB-DL')
      expect(TrashSourceClassifier.classify('clip.uHd ReMuX.mkv')).toBe('Remux')
    })
  })
})
