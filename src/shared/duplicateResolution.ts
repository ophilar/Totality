export interface DuplicateResolutionError {
  mediaItemId: number
  message: string
}

export type DuplicateResolutionOutcome =
  | { status: 'kept'; committedCount: 0; requestedCount: number; errors: [] }
  | { status: 'deleted'; committedCount: number; requestedCount: number; errors: [] }
  | { status: 'policy-blocked'; committedCount: 0; requestedCount: number; errors: [] }
  | { status: 'partial'; committedCount: number; requestedCount: number; errors: DuplicateResolutionError[] }
  | { status: 'failed'; committedCount: number; requestedCount: number; errors: DuplicateResolutionError[] }
