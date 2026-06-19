/**
 * Tag REST operations. Thin functions over VoicenotesApiClient.
 */

import { VoicenotesApiClient } from "./client.js";
import type { CreateTagBody, Tag, UpdateTagBody } from "./types.js";

/** GET /api/tags — all tags for the user. */
export async function listTags(client: VoicenotesApiClient): Promise<Tag[]> {
  const res = await client.get<Tag[] | { data: Tag[] }>("/api/tags");
  return Array.isArray(res) ? res : res.data;
}

/** POST /api/tags — create a tag with auto-tagging keywords. */
export async function createTag(
  client: VoicenotesApiClient,
  body: CreateTagBody,
): Promise<Tag> {
  const res = await client.post<Tag | { data: Tag }>("/api/tags", body);
  return "data" in (res as object) ? (res as { data: Tag }).data : (res as Tag);
}

/** PATCH /api/tags/:id — update name/keywords/pin state. */
export async function updateTag(
  client: VoicenotesApiClient,
  id: number,
  body: UpdateTagBody,
): Promise<Tag> {
  const res = await client.patch<Tag | { data: Tag }>(`/api/tags/${id}`, body);
  return "data" in (res as object) ? (res as { data: Tag }).data : (res as Tag);
}

/** DELETE /api/tags/:id — permanent. */
export async function deleteTag(
  client: VoicenotesApiClient,
  id: number,
): Promise<void> {
  await client.delete<void>(`/api/tags/${id}`);
}
