/**
 * Recording (note) REST operations. Thin functions over VoicenotesApiClient —
 * no MCP concerns here, just HTTP. Tool handlers compose these.
 */

import { VoicenotesApiClient } from "./client.js";
import type {
  ListRecordingsParams,
  PaginatedRecordings,
  Recording,
  UpdateRecordingBody,
} from "./types.js";

/** GET /api/recordings?page&tag&from&to (Laravel page-based pagination). */
export async function listRecordings(
  client: VoicenotesApiClient,
  params: ListRecordingsParams & { page?: number },
): Promise<PaginatedRecordings> {
  const qs = new URLSearchParams();
  // Laravel uses ?page=N; keep cursor for back-compat if a caller still sends it.
  if (params.page != null) qs.set("page", String(params.page));
  else if (params.cursor != null) qs.set("page", String(params.cursor));
  if (params.tag) qs.set("tag", params.tag);
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  const query = qs.toString();
  return client.get<PaginatedRecordings>(
    `/api/recordings${query ? `?${query}` : ""}`,
  );
}

/**
 * Fetch EVERY recording by walking Laravel pages until exhausted. Returns the
 * flattened list. Guards against infinite loops with a hard page cap.
 */
export async function listAllRecordings(
  client: VoicenotesApiClient,
  params: ListRecordingsParams = {},
  maxPages = 200,
): Promise<Recording[]> {
  const all: Recording[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = await listRecordings(client, { ...params, page });
    const batch = res.data ?? [];
    if (batch.length === 0) break;
    all.push(...batch);
    // Stop conditions: Laravel exposes links.next=null or meta.current/last_page.
    const meta = (res.meta ?? {}) as { current_page?: number; last_page?: number };
    const nextLink = res.links?.next;
    if (nextLink === null) break;
    if (meta.last_page != null && meta.current_page != null && meta.current_page >= meta.last_page) break;
    // If the API ignores paging and returns the same page, stop after no growth.
    if (meta.last_page == null && nextLink == null && batch.length < (params.limit ?? (batch.length || 1))) break;
  }
  return all;
}

/** GET /api/recordings/:id — full note incl. transcript. */
export async function getRecording(
  client: VoicenotesApiClient,
  id: string,
): Promise<Recording> {
  // Some Voicenotes responses wrap the object in { data: {...} }.
  const res = await client.get<Recording | { data: Recording }>(
    `/api/recordings/${encodeURIComponent(id)}`,
  );
  return "data" in (res as object) ? (res as { data: Recording }).data : (res as Recording);
}

/** PATCH /api/recordings/:id — update title and/or tags (tags = full replace). */
export async function updateRecording(
  client: VoicenotesApiClient,
  id: string,
  body: UpdateRecordingBody,
): Promise<Recording> {
  const res = await client.patch<Recording | { data: Recording }>(
    `/api/recordings/${encodeURIComponent(id)}`,
    body,
  );
  return "data" in (res as object) ? (res as { data: Recording }).data : (res as Recording);
}

/** GET /api/recordings/search?q= — semantic/full-text search. */
export async function searchRecordings(
  client: VoicenotesApiClient,
  query: string,
): Promise<PaginatedRecordings> {
  return client.get<PaginatedRecordings>(
    `/api/recordings/search?q=${encodeURIComponent(query)}`,
  );
}

/** DELETE /api/recordings/:id — NOTE: unconfirmed endpoint (Group C stub uses this). */
export async function deleteRecording(
  client: VoicenotesApiClient,
  id: string,
): Promise<void> {
  await client.delete<void>(`/api/recordings/${encodeURIComponent(id)}`);
}
