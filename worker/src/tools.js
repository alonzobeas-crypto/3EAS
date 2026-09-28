// Tool/function definitions for A.I. BABY's site-navigation ability, built
// from the generated catalog (see scripts/gen-catalog.mjs) so the model's
// enum options can never list a scene or track that doesn't actually exist.
//
// This module only *describes* the tools and validates a proposed action
// shape — it never executes anything. Execution happens client-side, against
// its own independent whitelist (see index.html) — the client never trusts
// this server's validation alone, and this server never trusts the model's
// output alone either. Belt and suspenders.

import { TRACK_TITLES, SCENES, LINKS } from './catalog.js';

const SCENE_NAMES = SCENES.map((s) => s.name);

// Link keys the model may reference — open_link never takes a raw URL from
// the model, only one of these keys, resolved against the real ACCESS-scene
// URL server-side (and again, independently, client-side).
export const LINK_KEYS = LINKS.map((l) => l.key);

export const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'go_to_scene',
      description: "Scroll the site to one of its named scenes/sections.",
      parameters: {
        type: 'object',
        properties: { name: { type: 'string', enum: SCENE_NAMES } },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'play_track',
      description: 'Play a specific track from the site jukebox by title.',
      parameters: {
        type: 'object',
        properties: { title: { type: 'string', enum: TRACK_TITLES } },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'stop_music',
      description: 'Stop the site jukebox.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'open_link',
      description: 'Open one of a fixed set of external links in a new tab.',
      parameters: {
        type: 'object',
        properties: { key: { type: 'string', enum: LINK_KEYS } },
        required: ['key'],
      },
    },
  },
];

// Validates one { type, ...params } action against the same catalog the
// tools were generated from. Returns the action unchanged if valid, or null.
// Server-side defense in depth — the client independently re-validates
// everything it receives before ever calling a real site function.
export function validateAction(action) {
  if (!action || typeof action !== 'object') return null;
  switch (action.type) {
    case 'go_to_scene':
      return typeof action.name === 'string' && SCENE_NAMES.includes(action.name)
        ? { type: 'go_to_scene', name: action.name }
        : null;
    case 'play_track':
      return typeof action.title === 'string' && TRACK_TITLES.includes(action.title)
        ? { type: 'play_track', title: action.title }
        : null;
    case 'stop_music':
      return { type: 'stop_music' };
    case 'open_link':
      return typeof action.key === 'string' && LINK_KEYS.includes(action.key)
        ? { type: 'open_link', key: action.key }
        : null;
    default:
      return null;
  }
}

// Turns an OpenRouter/OpenAI-shaped tool_calls array (from the live LLM
// response) into validated actions, silently dropping anything malformed or
// unrecognized rather than throwing — a model hallucinating a bad call
// should never break the reply, just skip that one action.
export function toolCallsToActions(toolCalls) {
  if (!Array.isArray(toolCalls)) return [];
  const actions = [];
  for (const call of toolCalls) {
    const name = call?.function?.name;
    if (!name) continue;
    let args;
    try {
      args = JSON.parse(call.function.arguments || '{}');
    } catch {
      continue;
    }
    const validated = validateAction({ type: name, ...args });
    if (validated) actions.push(validated);
  }
  return actions;
}
