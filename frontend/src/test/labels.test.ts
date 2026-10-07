/**
 * The presentation vocabulary, censused against the contract enums (#48).
 *
 * Each map in `lib/labels.ts` is typed as a complete `Record<Enum, …>`, which catches a
 * contract change at compile time. These tests catch the other half: a key that exists but
 * says nothing useful, an order list that drifted from its map, a glyph missing, and a
 * terminal status the rail does not stop on.
 *
 * The enum members come from the generated schema's text, so this file checks the labels
 * against the contract — not against another list someone typed here.
 */

import { describe, expect, it } from "vitest";

import {
  ACTION_LABELS,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  EVENT_LABELS,
  NEXT_ACTOR,
  PRIORITY_LABELS,
  PRIORITY_ORDER,
  RAIL_STEPS,
  ROLE_LABELS,
  STATUS_ICONS,
  STATUS_LABELS,
  STATUS_ORDER,
  STATUS_STEP,
  STATUS_TONES,
  TERMINAL_STATUSES,
  TERMINAL_STEP,
  hasAction,
  isTerminal,
  statusStep,
} from "../lib/labels";
import type { TicketAction } from "../api";
import schema from "../api/generated/schema.d.ts?raw";

/** Members of a generated string-union alias, e.g. `TicketStatus: "A" | "B";` */
function enumMembers(alias: string): string[] {
  const line = schema.match(new RegExp(`^\\s{8}${alias}: (.*);$`, "m"))?.[1];
  if (!line) throw new Error(`${alias} not found in the generated schema`);
  return [...line.matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]);
}

const ENUMS = {
  TicketStatus: enumMembers("TicketStatus"),
  Category: enumMembers("Category"),
  Priority: enumMembers("Priority"),
  Role: enumMembers("Role"),
  EventType: enumMembers("EventType"),
  TicketAction: enumMembers("TicketAction"),
};

describe("the census itself", () => {
  it("found every enum it claims to have found", () => {
    // If a pattern silently matched nothing, every assertion below would pass vacuously.
    expect(ENUMS.TicketStatus).toHaveLength(8);
    expect(ENUMS.Category).toHaveLength(6);
    expect(ENUMS.Priority).toHaveLength(3);
    expect(ENUMS.Role).toHaveLength(3);
    expect(ENUMS.EventType).toHaveLength(9);
    expect(ENUMS.TicketAction).toHaveLength(9);
  });
});

/** Each label map is keyed by the enum alias it must cover, so `ENUMS[alias]` below is a
 *  lookup the compiler can check rather than a string index that quietly yields undefined. */
type EnumAlias = keyof typeof ENUMS;

const MAPS: Record<EnumAlias, Record<string, string>> = {
  TicketStatus: STATUS_LABELS,
  Category: CATEGORY_LABELS,
  Priority: PRIORITY_LABELS,
  Role: ROLE_LABELS,
  EventType: EVENT_LABELS,
  TicketAction: ACTION_LABELS,
};

describe("label maps cover the contract enums", () => {
  // Object.entries widens the key to `string`; the cast puts it back to the alias union so
  // `ENUMS[alias]` is a checked lookup instead of an index that can silently miss.
  it.each(Object.entries(MAPS) as Array<[EnumAlias, Record<string, string>]>)("%s", (alias, map) => {
    expect(Object.keys(map).sort()).toEqual([...ENUMS[alias]].sort());
  });

  it.each(Object.entries(MAPS))("%s renders as text, never blank", (_alias, map) => {
    for (const [key, label] of Object.entries(map)) {
      expect(label.trim().length, key).toBeGreaterThan(0);
      // A single-word acronym may keep its own name (HVAC); a compound code must be
      // turned into words, otherwise the UI is showing the enum to the user.
      if (key.includes("_")) expect(label, key).not.toBe(key);
    }
  });
});

describe("status decorations stay in step", () => {
  it("tones, glyphs, next-actor copy and rail position all key off the same set", () => {
    const keys = Object.keys(STATUS_LABELS).sort();
    expect(Object.keys(STATUS_TONES).sort()).toEqual(keys);
    expect(Object.keys(STATUS_ICONS).sort()).toEqual(keys);
    expect(Object.keys(NEXT_ACTOR).sort()).toEqual(keys);
    expect(Object.keys(STATUS_STEP).sort()).toEqual(keys);
  });

  it("never relies on colour alone", () => {
    // Tone groups statuses; if two adjacent workflow states shared a tone, the badge
    // would carry no information the label does not already give. Here the check is that
    // each of the eight has *a* tone and that the set is drawn from the declared tones.
    const tones = new Set(Object.values(STATUS_TONES));
    for (const tone of tones) {
      expect(["info", "indigo", "teal", "elevated", "success", "muted", "danger"]).toContain(tone);
    }
    expect(tones.size).toBeGreaterThan(3);
  });

  it("gives every status a glyph", () => {
    for (const [status, icon] of Object.entries(STATUS_ICONS)) {
      expect(icon, status).toBeTruthy();
    }
  });
});

describe("order lists", () => {
  it("STATUS_ORDER is its map, not a second copy", () => {
    expect(STATUS_ORDER).toEqual(Object.keys(STATUS_LABELS));
  });

  it("starts at SUBMITTED, which is what a reporter's timeline reads as", () => {
    expect(STATUS_ORDER[0]).toBe("SUBMITTED");
  });

  it("CATEGORY_ORDER is its map too", () => {
    expect(CATEGORY_ORDER).toEqual(Object.keys(CATEGORY_LABELS));
  });

  it("puts HIGH first, because that is the one display order that is not the map's", () => {
    expect(PRIORITY_ORDER).toEqual(["HIGH", "MEDIUM", "LOW"]);
    expect([...PRIORITY_ORDER].sort()).toEqual(Object.keys(PRIORITY_LABELS).sort());
  });
});

describe("terminal statuses", () => {
  it("are exactly the three the state machine ends on", () => {
    expect([...TERMINAL_STATUSES].sort()).toEqual(["CANCELLED", "CLOSED", "REJECTED"]);
    for (const status of TERMINAL_STATUSES) expect(isTerminal(status)).toBe(true);
    for (const status of STATUS_ORDER.filter((s) => !TERMINAL_STATUSES.includes(s))) {
      expect(isTerminal(status)).toBe(false);
    }
  });

  it("keep every status on a step the rail actually draws", () => {
    for (const status of STATUS_ORDER) {
      const step = STATUS_STEP[status];
      expect(step, status).toBeGreaterThanOrEqual(0);
      expect(step, status).toBeLessThan(RAIL_STEPS.length);
    }
    expect(statusStep("CLOSED")).toBe(RAIL_STEPS.length - 1);
  });

  it("name the state each terminal status stopped in", () => {
    // CLOSED is terminal but successful, so it needs no special stopping colour; the two
    // that do must both be present or the rail renders them as ordinary progress.
    expect(Object.keys(TERMINAL_STEP).sort()).toEqual(["CANCELLED", "REJECTED"]);
    expect(isTerminal("CLOSED")).toBe(true);
  });
});

describe("rail steps", () => {
  it("reference only declared events", () => {
    const events = RAIL_STEPS.map((step) => step.event);
    expect(new Set(events).size).toBe(events.length);
    for (const event of events) expect(ENUMS.EventType).toContain(event);
  });

  it("has no step for rework, which returns the ticket rather than advancing it", () => {
    expect(RAIL_STEPS.map((s) => s.event)).not.toContain("REWORK_REQUESTED");
  });
});

describe("hasAction", () => {
  it("matches the server's tokens exactly", () => {
    expect(hasAction(["REVIEW", "ASSIGN"], "REVIEW")).toBe(true);
    expect(hasAction(["REVIEW"], "ASSIGN")).toBe(false);
  });

  it("is false for an empty capability list, which is what a terminal ticket gets", () => {
    // The census yields plain strings; `hasAction` takes the contract's union, so the
    // cast is the boundary between "text found in a file" and "a member of the enum".
    for (const action of ENUMS.TicketAction as TicketAction[]) expect(hasAction([], action)).toBe(false);
  });
});
