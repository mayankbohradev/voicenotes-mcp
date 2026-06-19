/**
 * Tag tool handlers.
 */

import { VoicenotesApiClient } from "../api/client.js";
import { listTags, createTag, updateTag, deleteTag } from "../api/tags.js";
import { ok, fail, PERSONAL_OS_TAGS } from "./shared.js";

export async function vnListTags(client: VoicenotesApiClient) {
  try {
    const tags = await listTags(client);
    return ok({
      tags: tags.map((t) => ({
        id: t.id,
        name: t.name,
        keywords: t.keywords ?? [],
        is_pinned: Boolean(t.is_pinned),
        recordings_count: t.recordings_count ?? t.count ?? null,
      })),
      count: tags.length,
    });
  } catch (err) {
    return fail(err);
  }
}

export async function vnCreateTag(
  client: VoicenotesApiClient,
  args: { name: string; keywords?: string[]; is_pinned?: boolean; emoji?: string },
) {
  try {
    const t = await createTag(client, {
      name: args.name,
      keywords: args.keywords ?? [],
      is_pinned: args.is_pinned ? 1 : 0,
      emoji: args.emoji,
    });
    return ok({ id: t.id, name: t.name, created: true });
  } catch (err) {
    return fail(err);
  }
}

export async function vnUpdateTag(
  client: VoicenotesApiClient,
  args: { id: number; name?: string; keywords?: string[]; is_pinned?: boolean },
) {
  try {
    const t = await updateTag(client, args.id, {
      name: args.name,
      keywords: args.keywords,
      is_pinned: args.is_pinned == null ? undefined : args.is_pinned ? 1 : 0,
    });
    return ok({ id: t.id, name: t.name, updated: true });
  } catch (err) {
    return fail(err);
  }
}

export async function vnDeleteTag(client: VoicenotesApiClient, args: { id: number }) {
  try {
    await deleteTag(client, args.id);
    return ok({ id: args.id, deleted: true });
  } catch (err) {
    return fail(err);
  }
}

/**
 * vn_setup_tags — one-shot creation of the 10 personal-OS tags.
 * Idempotent: skips tags whose name already exists (case-insensitive).
 * dry_run reports what WOULD happen without writing.
 */
export async function vnSetupTags(
  client: VoicenotesApiClient,
  args: { dry_run?: boolean },
) {
  try {
    const existing = await listTags(client);
    const existingNames = new Set(existing.map((t) => t.name.toLowerCase()));

    const toCreate = PERSONAL_OS_TAGS.filter(
      (t) => !existingNames.has(t.name.toLowerCase()),
    );
    const skipped = PERSONAL_OS_TAGS.filter((t) =>
      existingNames.has(t.name.toLowerCase()),
    ).map((t) => t.name);

    if (args.dry_run) {
      return ok({
        dry_run: true,
        would_create: toCreate.map((t) => t.name),
        would_skip: skipped,
      });
    }

    const created: string[] = [];
    const errors: Array<{ name: string; error: string }> = [];
    for (const tag of toCreate) {
      try {
        await createTag(client, {
          name: tag.name,
          keywords: tag.keywords,
          is_pinned: 0,
        });
        created.push(tag.name);
      } catch (err) {
        errors.push({ name: tag.name, error: (err as Error).message });
      }
    }

    return ok({
      created,
      created_count: created.length,
      skipped,
      skipped_count: skipped.length,
      errors,
    });
  } catch (err) {
    return fail(err);
  }
}
