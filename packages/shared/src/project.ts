/**
 * Runtime schema for a saved project.
 *
 * `editor/types.ts` describes the project to the compiler, which is enough while the value stays
 * inside the app. These schemas cover the two places it does not: a project read back from IndexedDB
 * (M5), which may have been written by an older build or corrupted, and a project arriving over HTTP
 * from the browser (M7). Both are untrusted input, and neither is checked by TypeScript.
 *
 * It lives in `shared` because the agent endpoint on the server validates the same shape.
 */

import { z } from 'zod'

/** Bump when the stored shape changes, and add a migration for the old one. */
export const CURRENT_PROJECT_VERSION = 1

const msSchema = z.number().int().nonnegative()

export const clipSchema = z
  .object({
    id: z.string().min(1),
    sourceId: z.string().min(1),
    sourceIn: msSchema,
    sourceOut: msSchema,
    start: msSchema,
  })
  // A zero-length or inverted window is not a clip. Rejecting it here keeps a corrupt save from
  // reaching the timeline, where it would draw as a zero-width smear that cannot be grabbed.
  .refine((clip) => clip.sourceOut > clip.sourceIn, {
    message: 'sourceOut must be greater than sourceIn',
    path: ['sourceOut'],
  })

export const trackSchema = z.object({
  id: z.string().min(1),
  clips: z.array(clipSchema),
})

export const projectSchema = z.object({
  version: z.literal(CURRENT_PROJECT_VERSION),
  durationMs: msSchema,
  tracks: z.array(trackSchema),
})

export type StoredClip = z.infer<typeof clipSchema>
export type StoredTrack = z.infer<typeof trackSchema>
export type StoredProject = z.infer<typeof projectSchema>

/** Just the version, read before the full parse so a newer save can be reported rather than rejected as junk. */
export const versionProbeSchema = z.object({ version: z.number() })
