# Transcoding Subsystem Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Overhaul Totality's transcoding subsystem with zero-copy VRAM hardware pipelines, anti-stutter timestamp passthrough, dynamic NVENC rate control (`VBR_HQ` / dynamic CQ), and a modern 3-tab wizard UI.

**Architecture:** Apply the SOLID Strategy pattern (`ITranscodeCommandBuilder`) with vendor-specific builders (`NvidiaCommandBuilder`, `IntelCommandBuilder`, `SoftwareCommandBuilder`) managed by `TranscodeCommandFactory`. Decompose `TranscodeModal.tsx` into clean, single-responsibility React tab components (`QuickPresetsTab`, `AdvancedTab`, `LiveEncodingTab`).

**Tech Stack:** TypeScript, Electron IPC, React, Tailwind CSS, FFmpeg (with NVENC/QSV CUDA VRAM pipelines), HandBrake CLI, Vitest.

## Global Constraints

- Strict adherence to Universal Project Constitution (H:\.standards\constitutions\universal.md).
- Zero tolerance for silent error swallowing, fake fallbacks, or dummy returns; throw structured `TranscodeError` diagnostics.
- Preserve source 10-bit color formats (`p010le`), HDR10, and Dolby Vision metadata.
- Enforce `-fps_mode passthrough` for timestamp integrity and stutter elimination.

---

### Task 1: Command Builder Strategy & Types (`ITranscodeCommandBuilder`)

**Files:**
- Create: `src/main/services/transcoding/types.ts`
- Create: `src/main/services/transcoding/NvidiaCommandBuilder.ts`
- Create: `src/main/services/transcoding/IntelCommandBuilder.ts`
- Create: `src/main/services/transcoding/SoftwareCommandBuilder.ts`
- Create: `src/main/services/transcoding/TranscodeCommandFactory.ts`
- Test: `tests/unit/services/TranscodingBuilders.test.ts`

**Interfaces:**
- Consumes: `MediaAnalysis` from `@main/services/MediaFileAnalyzer`, `TranscodeOptions` from `@main/services/TranscodingService`.
- Produces: `ITranscodeCommandBuilder` interface, `TranscodeCommandFactory.getBuilder(...)`.

- [ ] **Step 1: Write failing unit test for command builders**

```typescript
// tests/unit/services/TranscodingBuilders.test.ts
import { describe, it, expect } from 'vitest'
import { NvidiaCommandBuilder } from '../../../src/main/services/transcoding/NvidiaCommandBuilder'
import { TranscodeOptions } from '../../../src/main/services/TranscodingService'

describe('NvidiaCommandBuilder', () => {
  it('builds zero-copy CUDA VRAM NVENC arguments with -fps_mode passthrough', () => {
    const builder = new NvidiaCommandBuilder()
    const options: TranscodeOptions = {
      targetCodec: 'hevc',
      crf: 20,
      preset: 'p6',
      useGpu: true
    }
    const analysis = { format: { duration: 100 }, video: { width: 1920, height: 1080, pix_fmt: 'yuv420p10le' }, audio: [], subtitles: [] }
    const args = builder.buildFFmpegArgs('input.mkv', 'output.mkv', options, analysis as any)

    expect(args).toContain('-hwaccel')
    expect(args).toContain('cuda')
    expect(args).toContain('-hwaccel_output_format')
    expect(args).toContain('cuda')
    expect(args).toContain('-fps_mode')
    expect(args).toContain('passthrough')
    expect(args).toContain('-rc')
    expect(args).toContain('vbr')
    expect(args).toContain('-cq')
    expect(args).toContain('20')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/services/TranscodingBuilders.test.ts`
Expected: FAIL with missing module/class errors.

- [ ] **Step 3: Implement Strategy Builder classes**

Create `src/main/services/transcoding/types.ts`:
```typescript
import { TranscodeOptions, TranscodingParams } from '../TranscodingService'
import { MediaAnalysis } from '../MediaFileAnalyzer'

export interface ITranscodeCommandBuilder {
  buildFFmpegArgs(input: string, output: string, options: TranscodeOptions, analysis: MediaAnalysis): string[]
  buildHandbrakeArgs(input: string, output: string, options: TranscodeOptions, analysis: MediaAnalysis): string[]
}
```

Create `src/main/services/transcoding/NvidiaCommandBuilder.ts`:
```typescript
import { ITranscodeCommandBuilder } from './types'
import { TranscodeOptions } from '../TranscodingService'
import { MediaAnalysis } from '../MediaFileAnalyzer'

export class NvidiaCommandBuilder implements ITranscodeCommandBuilder {
  buildFFmpegArgs(input: string, output: string, options: TranscodeOptions, analysis: MediaAnalysis): string[] {
    const args: string[] = [
      '-y',
      '-fps_mode', 'passthrough',
      '-hwaccel', 'cuda',
      '-hwaccel_output_format', 'cuda',
      '-i', input
    ]
    const codec = options.targetCodec === 'av1' ? 'av1_nvenc' : 'hevc_nvenc'
    const cq = (options.crf ?? 20).toString()
    const preset = options.preset || 'p6'

    args.push(
      '-c:v', codec,
      '-preset', preset,
      '-rc', 'vbr',
      '-cq', cq,
      '-b:v', '0',
      '-spatial-aq', '1',
      '-temporal-aq', '1',
      '-b_ref_mode', 'middle'
    )

    if (analysis.video?.pix_fmt?.includes('10') || options.targetCodec === 'av1') {
      args.push('-vf', 'scale_cuda=format=p010le')
    }

    if (options.preserveAllAudio) {
      args.push('-c:a', 'copy')
    } else {
      args.push('-map', '0:v:0', '-map', '0:a:0?', '-c:a', 'copy')
    }

    if (options.preserveSubtitles) {
      args.push('-map', '0:s?', '-c:s', 'copy')
    }

    args.push(output)
    return args
  }

  buildHandbrakeArgs(input: string, output: string, options: TranscodeOptions, _analysis: MediaAnalysis): string[] {
    const encoder = options.targetCodec === 'av1' ? 'nvenc_av1_10bit' : 'nvenc_h265_10bit'
    return [
      '--encoder', encoder,
      '--quality', (options.crf ?? 20).toString(),
      '--encoder-preset', 'quality',
      '--encopts', 'spatial-aq=1:temporal-aq=1:b-ref-mode=middle',
      '--all-audio',
      '--all-subtitles'
    ]
  }
}
```

Create `src/main/services/transcoding/IntelCommandBuilder.ts`:
```typescript
import { ITranscodeCommandBuilder } from './types'
import { TranscodeOptions } from '../TranscodingService'
import { MediaAnalysis } from '../MediaFileAnalyzer'

export class IntelCommandBuilder implements ITranscodeCommandBuilder {
  buildFFmpegArgs(input: string, output: string, options: TranscodeOptions, analysis: MediaAnalysis): string[] {
    const codec = options.targetCodec === 'av1' ? 'av1_qsv' : 'hevc_qsv'
    const quality = (options.crf ?? 20).toString()

    return [
      '-y',
      '-fps_mode', 'passthrough',
      '-init_hw_device', 'qsv=qsv',
      '-filter_hw_device', 'qsv',
      '-hwaccel', 'qsv',
      '-hwaccel_output_format', 'qsv',
      '-i', input,
      '-vf', 'vpp_qsv=format=p010le',
      '-c:v', codec,
      '-preset', options.preset || 'slow',
      '-global_quality', quality,
      '-look_ahead', '1',
      '-c:a', 'copy',
      output
    ]
  }

  buildHandbrakeArgs(input: string, output: string, options: TranscodeOptions, _analysis: MediaAnalysis): string[] {
    return [
      '--encoder', options.targetCodec === 'av1' ? 'qsv_av1' : 'qsv_h265_10bit',
      '--quality', (options.crf ?? 20).toString(),
      '--all-audio',
      '--all-subtitles'
    ]
  }
}
```

Create `src/main/services/transcoding/SoftwareCommandBuilder.ts`:
```typescript
import { ITranscodeCommandBuilder } from './types'
import { TranscodeOptions } from '../TranscodingService'
import { MediaAnalysis } from '../MediaFileAnalyzer'

export class SoftwareCommandBuilder implements ITranscodeCommandBuilder {
  buildFFmpegArgs(input: string, output: string, options: TranscodeOptions, analysis: MediaAnalysis): string[] {
    const codec = options.targetCodec === 'av1' ? 'libsvtav1' : 'libx265'
    const crf = (options.crf ?? 22).toString()

    return [
      '-y',
      '-fps_mode', 'passthrough',
      '-i', input,
      '-c:v', codec,
      '-crf', crf,
      '-preset', options.preset || 'medium',
      '-pix_fmt', 'yuv420p10le',
      '-c:a', 'copy',
      output
    ]
  }

  buildHandbrakeArgs(input: string, output: string, options: TranscodeOptions, _analysis: MediaAnalysis): string[] {
    return [
      '--encoder', options.targetCodec === 'av1' ? 'svt_av1_10bit' : 'x265_10bit',
      '--quality', (options.crf ?? 22).toString(),
      '--encoder-preset', options.preset || 'medium',
      '--all-audio',
      '--all-subtitles'
    ]
  }
}
```

Create `src/main/services/transcoding/TranscodeCommandFactory.ts`:
```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/services/TranscodingBuilders.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/main/services/transcoding/ tests/unit/services/TranscodingBuilders.test.ts
git commit -m "feat(transcoding): implement SOLID command builder strategy pattern for NVENC and QSV"
```

---

### Task 2: Refactor `TranscodingService.ts` for Hardware Builders & Diagnostics

**Files:**
- Modify: `src/main/services/TranscodingService.ts`
- Test: `tests/unit/services/TranscodingService.test.ts`

**Interfaces:**
- Consumes: `TranscodeCommandFactory`, `TranscodeError` diagnostic wrapper.
- Produces: Refactored `TranscodingService.getTranscodeParameters` and `TranscodingService.runFFmpeg` execution pipeline.

- [ ] **Step 1: Write unit test for TranscodingService refactor**

Add test checking `TranscodingService.getTranscodeParameters` delegates to `TranscodeCommandFactory`.

- [ ] **Step 2: Implement TranscodingService refactor**

In `src/main/services/TranscodingService.ts`:
- Integrate `TranscodeCommandFactory.getBuilder`.
- Use generated FFmpeg & HandBrake args in process execution.
- Capture full `stderr` output on error to throw structured `TranscodeError`.

- [ ] **Step 3: Run unit tests**

Run: `npx vitest run tests/unit/services/TranscodingService.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit Task 2**

```bash
git add src/main/services/TranscodingService.ts tests/unit/services/TranscodingService.test.ts
git commit -m "refactor(transcoding): integrate command builders and strict process diagnostics in TranscodingService"
```

---

### Task 3: Implement Modern 3-Tab Wizard UI (`TranscodeModal.tsx`)

**Files:**
- Create: `src/renderer/src/components/library/transcoding/QuickPresetsTab.tsx`
- Create: `src/renderer/src/components/library/transcoding/AdvancedTab.tsx`
- Create: `src/renderer/src/components/library/transcoding/LiveEncodingTab.tsx`
- Modify: `src/renderer/src/components/library/TranscodeModal.tsx`

**Interfaces:**
- Consumes: Electron IPC APIs (`window.electronAPI.getParameters`, `window.electronAPI.transcode`, `window.electronAPI.onProgress`).
- Produces: Decomposed React 3-Tab Wizard modal.

- [ ] **Step 1: Create `QuickPresetsTab.tsx`**

Implement card-based preset selection (*Visually Lossless Archival*, *Balanced Smooth HQ*, *High Efficiency*) displaying estimated MB/min and quality score badges.

- [ ] **Step 2: Create `AdvancedTab.tsx`**

Implement accordion sections for Engine, GPU Vendor, Quality CQ slider, Audio/Subtitle stream selection, and Frame Sync mode.

- [ ] **Step 3: Create `LiveEncodingTab.tsx`**

Implement active encoding progress gauge, current FPS, speed multiplier (e.g. `3.4x`), ETA, and a collapsible real-time terminal log drawer.

- [ ] **Step 4: Refactor `TranscodeModal.tsx` to host tabs**

Cleanly compose the tabs inside `TranscodeModal.tsx`.

- [ ] **Step 5: Verify building & linting**

Run: `npx tsc --noEmit`
Expected: PASS with 0 errors.

- [ ] **Step 6: Commit Task 3**

```bash
git add src/renderer/src/components/library/transcoding/ src/renderer/src/components/library/TranscodeModal.tsx
git commit -m "feat(ui): redesign TranscodeModal into modern 3-tab wizard UI"
```

---

### Task 4: Verification & Final System Audit

- [ ] **Step 1: Run full test suite**

Run: `npm run test`
Expected: All unit and integration tests PASS.

- [ ] **Step 2: Run linter and typecheck**

Run: `npm run lint` && `npx tsc --noEmit`
Expected: Clean build with 0 errors.

- [ ] **Step 3: Commit final verification**

```bash
git add .
git commit -m "chore: verify transcoding redesign and clean build"
```
