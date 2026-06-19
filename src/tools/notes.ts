/**
 * Note (recording) tool handlers. Each returns a CallToolResult; operational
 * failures are wrapped in-band via fail() so the model can recover.
 */

import { VoicenotesApiClient } from "../api/client.js";
import {
  listRecordings,
  listAllRecordings,
  getRecording,
  updateRecording,
  searchRecordings,
  deleteRecording,
} from "../api/recordings.js";
import { tagName, type Recording } from "../api/types.js";
import { ok, fail } from "./shared.js";

/** Trim a transcript to a short preview for list views. */
function preview(text: string | null | undefined, max = 200): string {
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Normalize a recording for list output (compact). */
function toListItem(r: Recording) {
  return {
    id: r.id,
    title: r.title,
    tags: (r.tags ?? []).map(tagName),
    transcript_preview: preview(r.transcript),
    created_at: r.created_at,
  };
}

export async function vnListNotes(
  client: VoicenotesApiClient,
  args: {
    limit?: number;
    page?: number;
    cursor?: number;
    tag?: string;
    date_from?: string;
    date_to?: string;
    fetch_all?: boolean;
  },
) {
  try {
    // fetch_all: walk every Laravel page and return the full set.
    if (args.fetch_all) {
      const recs = await listAllRecordings(client, {
        tag: args.tag,
        from: args.date_from,
        to: args.date_to,
      });
      return ok({
        notes: recs.map(toListItem),
        count: recs.length,
        fetched_all: true,
      });
    }

    const res = await listRecordings(client, {
      limit: args.limit,
      page: args.page ?? args.cursor,
      tag: args.tag,
      from: args.date_from,
      to: args.date_to,
    });
    const items = (res.data ?? []).map(toListItem);
    const meta = (res.meta ?? {}) as {
      current_page?: number;
      last_page?: number;
      total?: number;
      next_cursor?: number | string | null;
    };
    return ok({
      notes: items,
      count: items.length,
      page: meta.current_page ?? args.page ?? 1,
      last_page: meta.last_page ?? null,
      total: meta.total ?? null,
      has_more:
        meta.last_page != null && meta.current_page != null
          ? meta.current_page < meta.last_page
          : res.links?.next != null,
    });
  } catch (err) {
    return fail(err);
  }
}

export async function vnGetNote(client: VoicenotesApiClient, args: { id: string }) {
  try {
    const r = await getRecording(client, args.id);
    return ok({
      id: r.id,
      title: r.title,
      transcript: r.transcript ?? null,
      tags: (r.tags ?? []).map(tagName),
      created_at: r.created_at,
      updated_at: r.updated_at,
      duration: r.duration,
    });
  } catch (err) {
    return fail(err);
  }
}

export async function vnSearchNotes(
  client: VoicenotesApiClient,
  args: { query: string; limit?: number },
) {
  try {
    const res = await searchRecordings(client, args.query);
    let items = (res.data ?? []).map(toListItem);
    if (args.limit != null) items = items.slice(0, args.limit);
    return ok({ query: args.query, notes: items, count: items.length });
  } catch (err) {
    return fail(err);
  }
}

export async function vnUpdateNote(
  client: VoicenotesApiClient,
  args: { id: string; title?: string; tags?: string[]; transcript?: string },
) {
  try {
    if (args.title == null && args.tags == null && args.transcript == null) {
      return fail(new Error("Provide at least one of: title, tags, transcript."));
    }

    // Voicenotes' PATCH behaves like a full replace: fields not sent can be
    // dropped. So when the caller updates ONLY title/transcript (no new tags),
    // we read the note first and re-send its existing tags to avoid wiping them.
    let tags = args.tags;
    if (tags == null) {
      const current = await getRecording(client, args.id);
      tags = (current.tags ?? []).map(tagName);
    }

    const r = await updateRecording(client, args.id, {
      title: args.title,
      tags, // explicit tags, or preserved existing ones
      transcript: args.transcript,
    });
    return ok({
      id: r.id,
      title: r.title,
      tags: (r.tags ?? []).map(tagName),
      transcript_updated: args.transcript != null,
      updated: true,
    });
  } catch (err) {
    return fail(err);
  }
}

/**
 * vn_bulk_tag_notes — ADD tags to many notes WITHOUT dropping existing tags.
 *
 * The API only offers tag REPLACEMENT (PATCH {tags}), so "add" must be a
 * read-modify-write per note: read current tags, union with tags_to_add, patch
 * the merged set. This helper performs the per-note merge+patch and aggregates
 * results so a failure on one note doesn't abort the rest.
 *
 * >>> CONTRIBUTION POINT (see mergeAndPatchNote below) <<<
 */
export async function vnBulkTagNotes(
  client: VoicenotesApiClient,
  args: { note_ids: string[]; tags_to_add: string[] },
) {
  const updated: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];

  for (const id of args.note_ids) {
    try {
      await mergeAndPatchNote(client, id, args.tags_to_add);
      updated.push(id);
    } catch (err) {
      failed.push({ id, error: (err as Error).message });
    }
  }

  return ok({
    requested: args.note_ids.length,
    updated_count: updated.length,
    failed_count: failed.length,
    updated,
    failed,
  });
}

/**
 * Merge `tagsToAdd` into a note's existing tags and PATCH the result
 * (read-modify-write, since the API only supports tag REPLACEMENT).
 *
 * Policy:
 *   - Tags are trimmed; empty entries dropped.
 *   - Dedupe is CASE-INSENSITIVE, keeping the EXISTING casing as canonical
 *     (a note tagged "Work" + adding "work" stays "Work", no duplicate).
 *   - If nothing new would be added, the PATCH is SKIPPED entirely to avoid a
 *     needless write per already-tagged note (rate-limit friendly across N).
 */
async function mergeAndPatchNote(
  client: VoicenotesApiClient,
  id: string,
  tagsToAdd: string[],
): Promise<void> {
  const current = await getRecording(client, id);
  const existing = (current.tags ?? []).map(tagName).map((t) => t.trim()).filter(Boolean);

  // Lowercased set of what's already present, to dedupe case-insensitively.
  const seen = new Set(existing.map((t) => t.toLowerCase()));
  const merged = [...existing];
  for (const raw of tagsToAdd) {
    const t = raw.trim();
    if (t && !seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase());
      merged.push(t);
    }
  }

  // No-op skip: nothing new -> don't spend a write.
  if (merged.length === existing.length) return;

  await updateRecording(client, id, { tags: merged });
}

// ---- Group A: create (delegated to official MCP at the HTTP/registration layer)
// vn_create_note's transcript-create has no confirmed REST endpoint; it is
// fulfilled via the official Voicenotes MCP create path. Implemented in
// server.ts where the upstream client is available.

// ---- Group C stub --------------------------------------------------------

export async function vnDeleteNote(
  client: VoicenotesApiClient,
  args: { id: string; confirm?: boolean },
) {
  // Endpoint unconfirmed in reverse-engineering; gated behind explicit confirm.
  if (!args.confirm) {
    return ok({
      not_executed: true,
      reason:
        "vn_delete_note is a Group C tool with an UNCONFIRMED DELETE endpoint. Re-call with confirm:true to attempt it.",
    });
  }
  try {
    await deleteRecording(client, args.id);
    return ok({ id: args.id, deleted: true });
  } catch (err) {
    return fail(err);
  }
}
