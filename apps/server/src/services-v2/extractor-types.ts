export type ExtractorResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string }

export function ok<T>(data: T): ExtractorResult<T> {
  return { ok: true, data }
}

export function fail<T = never>(error: string): ExtractorResult<T> {
  return { ok: false, error }
}
