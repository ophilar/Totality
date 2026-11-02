# Transcoding Subsystem Architecture & UI/UX Redesign Specification

## 1. Overview & Problem Statement
Transcoding in Totality currently suffers from poor quality, video jitter/stutter, visual macroblocking artifacts, and a cluttered UI. 
The root causes include:
- Inappropriate FFmpeg NVENC rate control (`-rc constqp` instead of zero-copy `-hwaccel cuda -hwaccel_output_format cuda -rc vbr -cq <crf> -b:v 0 -spatial-aq 1 -temporal-aq 1 -b_ref_mode middle`).
- Missing timestamp synchronization (`-fps_mode passthrough`), causing frame drops/repeats on variable frame rate (VFR) and high-bitrate 1080p/4K content.
- Corrupted or stripped 10-bit HDR10 & Dolby Vision metadata/color spaces (`p010le`).
- Cluttered, unorganized single-page modal UI in `TranscodeModal.tsx`.

This spec defines a hardware-accelerated, zero-copy transcoding engine using SOLID design patterns, alongside a modern 3-tab wizard UI.

---

## 2. Core Transcoding Engine & Hardware Pipeline

### 2.1 Hardware Surface Acceleration (Zero-Copy VRAM Pipeline)
To eliminate PCIe bus bottlenecks and frame transfer lag between RAM and VRAM:

- **NVIDIA NVENC / NVDEC:**
  ```bash
  ffmpeg -y -fps_mode passthrough \
    -hwaccel cuda -hwaccel_output_format cuda \
    -i <input> \
    -vf "scale_cuda=format=p010le" \
    -c:v hevc_nvenc -preset p6 \
    -rc vbr -cq 20 -b:v 0 -maxrate 35M -bufsize 70M \
    -spatial-aq 1 -temporal-aq 1 -b_ref_mode middle \
    -c:a copy <output>
  ```
- **Intel QuickSync (QSV):**
  ```bash
  ffmpeg -y -fps_mode passthrough \
    -init_hw_device qsv=qsv -filter_hw_device qsv \
    -hwaccel qsv -hwaccel_output_format qsv \
    -i <input> \
    -vf "vpp_qsv=format=p010le" \
    -c:v hevc_qsv -preset slow \
    -global_quality 20 -look_ahead 1 \
    -c:a copy <output>
  ```
- **Timestamp Integrity:** `-fps_mode passthrough` maintains original container timestamps to prevent micro-stutter.
- **HDR & Dolby Vision Preservation:** 10-bit color depth (`p010le`) and color space transfer functions are preserved for HDR10 and Dolby Vision (Profiles 5/7/8).

### 2.2 Software & CPU Encoders (SVT-AV1 / x265 / x264)
- **SVT-AV1:** `-c:v libsvtav1 -preset 5 -crf 24 -pix_fmt yuv420p10le -svtav1-params tune=0`
- **x265:** `-c:v libx265 -preset slow -crf 21 -pix_fmt yuv420p10le`

### 2.3 HandBrake CLI Argument Mapping
Matches FFmpeg NVENC/QSV/SVT-AV1 tunings using HandBrake CLI syntax:
`--encoder nvenc_h265_10bit --encoder-preset quality --encopts="spatial-aq=1:temporal-aq=1:b-ref-mode=middle"`

---

## 3. SOLID Architecture & Builders

### 3.1 Interface & Strategy Pattern
```typescript
export interface ITranscodeCommandBuilder {
  buildFFmpegArgs(input: string, output: string, options: TranscodeOptions, analysis: MediaAnalysis): string[]
  buildHandbrakeArgs(input: string, output: string, options: TranscodeOptions, analysis: MediaAnalysis): string[]
}
```
- `NvidiaCommandBuilder`: Specialized NVENC/NVDEC zero-copy VRAM pipeline args.
- `IntelCommandBuilder`: Specialized Intel QSV VPP zero-copy pipeline args.
- `SoftwareCommandBuilder`: SVT-AV1, x265, and x264 software args.
- `TranscodeCommandFactory`: Instantiates the appropriate builder based on vendor and options.

---

## 4. Quality Presets & Storage Efficiency Targets

Derived from industry MB/min and target bitrate limits:
- **Visually Lossless / Archival:** CQ 16-18, NVENC `p7`, 10-bit `p010le`, preserve all audio & subtitles.
- **Balanced HQ (Recommended):** CQ 20-22, NVENC `p6`, 10-bit `p010le`, high efficiency compression (~15-30 MB/min for 1080p, ~50-100 MB/min for 4K).
- **High Efficiency Space Saver:** CQ 24-26, NVENC `p5`, AV1/HEVC focus (~5-15 MB/min for 1080p).

---

## 5. UI/UX Component Architecture (`TranscodeModal.tsx`)

Decomposed into non-duplicative React components:
1. `QuickPresetsTab`: Visual preset cards with live MB/min & target size estimation badges.
2. `AdvancedTab`: Accordion sections for Engine/GPU hardware, Codec & CQ quality slider, Track management (audio downmixing/copy, subtitle stream mapping), Resolution scaling, and Frame sync mode.
3. `LiveEncodingTab`: Progress gauge, encoding speed (FPS & multiplier e.g. `3.4x`), ETA, and a collapsible real-time terminal log drawer.

---

## 6. Error Handling & Verification

- **Strict Validation:** All CLI parameters validated against Zod schemas before spawn.
- **Explicit Diagnostics:** Capture stderr on non-zero exit codes; throw structured `TranscodeError`.
- **Atomic File Management:** Temporary `.totality_tmp_*` creation and safe replacement.
- **Tests:** Unit tests verifying NVENC `-rc vbr`, `-fps_mode passthrough`, and 10-bit `p010le` arguments.
