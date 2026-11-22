import { describe, expect, it } from 'vitest'
import {
  isAudioDescriptionTrack,
  isAccessibilityTrack,
  isCommentaryTrack,
  isProtectedAudioTrack
} from '@main/services/utils/audioTrackUtils'

describe('audioTrackUtils', () => {
  describe('isCommentaryTrack', () => {
    it('returns true when isCommentary boolean flag is set', () => {
      expect(isCommentaryTrack({ isCommentary: true })).toBe(true)
    })

    it('returns true when comment disposition flag is 1', () => {
      expect(isCommentaryTrack({ disposition: { comment: 1 } })).toBe(true)
    })

    it('returns true when title matches commentary keywords', () => {
      expect(isCommentaryTrack({ title: "Director's Commentary" })).toBe(true)
      expect(isCommentaryTrack({ tags: { title: 'Cast Comment' } })).toBe(true)
    })

    it('returns false when no commentary indicator is present', () => {
      expect(isCommentaryTrack({ title: 'Main Feature Stereo' })).toBe(false)
    })
  })

  describe('isAudioDescriptionTrack', () => {
    it('returns true when isAudioDescription flag is set', () => {
      expect(isAudioDescriptionTrack({ isAudioDescription: true })).toBe(true)
    })

    it('returns true when visual_impaired disposition flag is 1', () => {
      expect(isAudioDescriptionTrack({ disposition: { visual_impaired: 1 } })).toBe(true)
    })

    it('returns true when title matches audio description keywords', () => {
      expect(isAudioDescriptionTrack({ title: 'English Audio Description' })).toBe(true)
      expect(isAudioDescriptionTrack({ title: 'Descriptive Track' })).toBe(true)
    })

    it('returns false when track is not audio description', () => {
      expect(isAudioDescriptionTrack({ title: 'English 5.1' })).toBe(false)
    })
  })

  describe('isAccessibilityTrack', () => {
    it('returns true when isAccessibility flag is set', () => {
      expect(isAccessibilityTrack({ isAccessibility: true })).toBe(true)
    })

    it('returns true when hearing_impaired disposition flag is 1', () => {
      expect(isAccessibilityTrack({ disposition: { hearing_impaired: 1 } })).toBe(true)
    })

    it('returns true when title matches accessibility keywords', () => {
      expect(isAccessibilityTrack({ title: 'Accessibility Audio' })).toBe(true)
      expect(isAccessibilityTrack({ title: 'Hearing Impaired Track' })).toBe(true)
      expect(isAccessibilityTrack({ title: 'Narration Track' })).toBe(true)
    })

    it('returns false when track is regular audio', () => {
      expect(isAccessibilityTrack({ title: 'English TrueHD' })).toBe(false)
    })
  })

  describe('isProtectedAudioTrack', () => {
    it('returns true for object audio tracks', () => {
      expect(isProtectedAudioTrack({ hasObjectAudio: true })).toBe(true)
    })

    it('returns true for commentary, audio description, or accessibility tracks', () => {
      expect(isProtectedAudioTrack({ isCommentary: true })).toBe(true)
      expect(isProtectedAudioTrack({ isAudioDescription: true })).toBe(true)
      expect(isProtectedAudioTrack({ isAccessibility: true })).toBe(true)
    })

    it('returns true for matching protected track titles', () => {
      expect(isProtectedAudioTrack({ title: 'Director Commentary' })).toBe(true)
      expect(isProtectedAudioTrack({ title: 'Descriptive Audio' })).toBe(true)
      expect(isProtectedAudioTrack({ title: 'Narration Track' })).toBe(true)
    })

    it('returns false for non-protected audio tracks', () => {
      expect(isProtectedAudioTrack({ title: 'English 5.1 DTS' })).toBe(false)
      expect(isProtectedAudioTrack({ title: 'Japanese FLAC' })).toBe(false)
    })
  })
})
