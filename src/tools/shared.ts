/**
 * Shared helpers for tool handlers: uniform success/error result shaping, and
 * the canonical "personal OS" tag definitions used by vn_setup_tags.
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { VoicenotesApiError } from "../api/client.js";

/** Wrap any JSON-serializable value as a successful MCP tool result. */
export function ok(data: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: isRecord(data) ? data : { result: data },
  };
}

/** Wrap an error as an MCP tool result (isError) rather than throwing.
 *  Operational failures stay in-band so the model can react/retry. */
export function fail(err: unknown): CallToolResult {
  if (err instanceof VoicenotesApiError) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              error: true,
              status: err.status,
              message: err.message,
              suggestion: err.suggestion,
              details: err.body,
            },
            null,
            2,
          ),
        },
      ],
    };
  }
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify(
          { error: true, message: (err as Error).message ?? String(err) },
          null,
          2,
        ),
      },
    ],
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Definition for one personal-OS tag. */
export interface PersonalOsTag {
  name: string;
  keywords: string[];
}

/**
 * The 10 personal-OS tags (Mayank's auto-tagging pipeline) created by
 * vn_setup_tags. Keywords drive Voicenotes' auto-tagging.
 */
export const PERSONAL_OS_TAGS: PersonalOsTag[] = [
  {
    name: "work",
    keywords: [
      "meeting", "shiva", "standup", "sprint", "deploy", "gradeless",
      "pull request", "backend", "API", "bug", "fix", "review", "Mansi",
      "Varun", "Arnav", "Paarth", "task for work", "office", "jira", "ticket",
      "feature", "production", "render", "supabase", "fastapi", "debugging",
      "code review", "release", "server", "endpoint", "database", "PR",
    ],
  },
  {
    name: "rehearsal",
    keywords: [
      "rehearsal", "mock interview", "voice interview", "placement", "OKR",
      "social sharing", "student", "campus", "Jaipuria", "interview platform",
      "Ask AI", "leaderboard", "referral", "faculty", "cohort", "onboarding",
      "10 bucket", "randomization", "gamification",
    ],
  },
  {
    name: "highlyt",
    keywords: [
      "highlyt", "knowledge graph", "highlight", "ICP", "positioning",
      "reddit outreach", "activation", "typed edges", "Rajika", "MCP server",
      "reading tool", "annotation", "semantic link", "highlyt.app",
      "PDF reader", "chrome extension", "product hunt", "knowledge management",
    ],
  },
  {
    name: "todo",
    keywords: [
      "todo", "karna hai", "I need to", "I have to", "reminder",
      "don't forget", "next step", "action item", "follow up", "schedule this",
      "add this", "create ticket", "note to self", "task", "pending",
      "remember to", "make sure to", "I should", "need to do",
    ],
  },
  {
    name: "idea",
    keywords: [
      "what if", "idea", "concept", "socha", "thinking about",
      "what about building", "automation idea", "product idea", "feature idea",
      "shower thought", "random thought", "what if we", "could we build",
      "new project idea", "wouldn't it be cool", "had a thought",
    ],
  },
  {
    name: "learning",
    keywords: [
      "samjha", "realized", "learned", "note this", "insight", "important",
      "I now understand", "key takeaway", "study", "grokking", "system design",
      "DSA", "course", "read this", "watched this", "understood",
      "mental model", "concept", "framework", "lesson", "discovered",
    ],
  },
  {
    name: "content",
    keywords: [
      "LinkedIn post", "blog idea", "Medium article", "write about",
      "post about", "content idea", "thread idea", "Fieldwork",
      "Substack note", "tweet", "reddit post", "viral", "hook", "angle",
      "write this down", "publish", "newsletter", "article idea", "post this",
    ],
  },
  {
    name: "journal",
    keywords: [
      "today I", "aaj", "so today", "good day", "bad day", "feeling", "ghar",
      "Jaipur", "Delhi", "family", "dada", "maa", "papa", "dinner", "lunch",
      "morning", "evening", "how I feel", "woke up", "went to", "came back",
      "binge watched", "slept", "yesterday", "this morning",
    ],
  },
  {
    name: "career",
    keywords: [
      "NeoSapien", "job application", "interview prep", "AI engineer",
      "resume", "portfolio", "salary", "career move", "Aryan", "Dhananjay",
      "application", "hire", "Aryan Yadav", "backend engineer",
      "founding engineer", "job hunt", "offer", "career decision", "role",
      "opportunity",
    ],
  },
  {
    name: "health",
    keywords: [
      "workout", "exercise", "khana", "calories", "weight", "protein", "gym",
      "fitness", "bloating", "sleep", "steps", "meal", "diet", "68 kg",
      "apna reboot", "vegetarian", "walk", "roti", "dal", "home workout",
      "eating", "nutrition", "healthy", "weight loss",
    ],
  },
];
