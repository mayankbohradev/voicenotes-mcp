/**
 * TypeScript interfaces for the Voicenotes REST API.
 *
 * These shapes are based on the responses observed when the API was mapped via
 * Chrome DevTools (2026-06-07). Fields the API may omit are marked optional, and
 * unknown extras are tolerated via index signatures so a schema drift on
 * Voicenotes' side doesn't crash us.
 */

/** A tag attached to a recording. The API sometimes returns tags as objects,
 *  sometimes as bare strings; callers should normalize via `tagName()`. */
export interface Tag {
  id: number;
  name: string;
  keywords?: string[];
  is_pinned?: 0 | 1 | boolean;
  emoji?: string | null;
  /** Some endpoints include a usage count under one of these names. */
  recordings_count?: number;
  count?: number;
  [key: string]: unknown;
}

/** A recording / note. */
export interface Recording {
  id: number | string;
  title: string | null;
  /** Full transcript text. May be absent in list views, present in detail views. */
  transcript?: string | null;
  /** Tags as returned by the API (objects or strings depending on endpoint). */
  tags?: Array<Tag | string>;
  created_at?: string;
  updated_at?: string;
  duration?: number;
  [key: string]: unknown;
}

/** Cursor-paginated list envelope (Laravel-style). */
export interface PaginatedRecordings {
  data: Recording[];
  /** Laravel pagination metadata varies; we read what's present. */
  next_cursor?: number | string | null;
  links?: { next?: string | null; prev?: string | null };
  meta?: { next_cursor?: number | string | null; [k: string]: unknown };
  [key: string]: unknown;
}

/** Filters for listing recordings (mirrors GET /api/recordings query params). */
export interface ListRecordingsParams {
  limit?: number;
  cursor?: number;
  tag?: string;
  from?: string; // ISO 8601
  to?: string; // ISO 8601
}

/** Body for creating a tag (POST /api/tags). */
export interface CreateTagBody {
  name: string;
  keywords: string[];
  is_pinned: 0 | 1;
  emoji?: string;
}

/** Body for updating a tag (PATCH /api/tags/:id). */
export interface UpdateTagBody {
  name?: string;
  keywords?: string[];
  is_pinned?: 0 | 1;
}

/** Body for updating a recording (PATCH /api/recordings/:id). */
export interface UpdateRecordingBody {
  title?: string;
  tags?: string[]; // full replacement list
  /** Corrected transcript text. NOTE: transcript-writability was not confirmed
   *  during reverse-engineering; the API may accept or ignore it. */
  transcript?: string;
}

/** Normalize a tag entry (object or string) to its display name. */
export function tagName(t: Tag | string): string {
  return typeof t === "string" ? t : t.name;
}
