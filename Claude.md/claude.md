# CLAUDE.md — TikTok Edits and Lyric Video System

## Project Purpose

Programmatic TikTok music video editor using Remotion. Creates professional short-form lyric videos with animated Swedish captions from config files.

## Tech Stack

- Remotion (React-based video renderer)
- Whisper.cpp (local Swedish speech transcription)
- ffmpeg (audio/video processing)
- TypeScript + React

## Critical Rules

- All @remotion/* packages must be exact same version (no ^ prefix)
- Whisper model must be non-.en (medium or large-v3) for Swedish
- Audio for Whisper: 16kHz mono WAV only
- Output: 1080x1920, 30fps, 9:16 vertical
- Use Remotion spring() for animations, never CSS transitions
- Language for transcription: "Swedish"

## Workflow

## Core Workflow

1. analyze-video → creates analysis JSON (run once per source video)
2. analyze-audio → beat detection for selected section  
3. create-edit → generates config JSON from analysis
4. Preview in Remotion Studio → tweak config if needed
5. render / batch-render → final output

## Quality Standard

Output must look like professional After Effects edit — not generic AI captions. This means:

- Text needs drop shadows + outlines for readability
- Animations should feel snappy not floaty (low damping, low mass in spring())
- Transitions between clips should be intentional, not random
- Color grading should be consistent across the video

## File Organization

- configs/ → one JSON per video
- public/audio/ → music tracks
- public/captions/ → whisper output JSONs  
- public/clips/ → source video clips
- src/components/ → React video components
- scripts/ → CLI utilities (transcribe, render, batch)

## When Editing This Project

- Test changes in Remotion Studio before rendering (`npx remotion studio`)
- Always validate captions JSON has correct Swedish words before rendering
- If Whisper output is bad for a track, manually fix the JSON — don't waste time re-running with different params
