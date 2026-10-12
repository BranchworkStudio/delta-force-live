// The enrolment gate: who a hand-over may make an account for. Pure, so its whole table is tested in
// gate_test.ts without a database or HQ (`node gate_test.ts` or `deno run gate_test.ts`).
export type Join = { kind: "group" | "invite"; via: string; solo: boolean; spent: boolean } | null;
export type Verdict =
  | { ok: true; via: string | null; onSquad: boolean }
  | { ok: false; error: string; reason: string };

/** `players` is how many accounts exist, needed only when this openid has none. */
export function decide(existing: { on_squad: boolean | null } | null, players: number | null, join: Join, typed: string): Verdict {
  if (existing) return { ok: true, via: null, onSquad: existing.on_squad !== false };
  if (players === 0) return { ok: true, via: "first", onSquad: true };        // empty board: the first hand-over claims it
  if (join?.kind === "invite" && !join.spent) return { ok: true, via: join.via, onSquad: !join.solo };
  // The link is real and it worked — for somebody else. That is a different answer from a wrong one
  // and deserves different words: there is nothing here to retype or check, only somebody to ask.
  if (join?.kind === "invite") return { ok: false, error: "that invite link has already been used", reason: "invite-used-up" };
  // A board code admits, it does not enrol: arriving on one without an account is somebody who was
  // forwarded six characters by a mate, not somebody the tracker's owner asked for.
  return { ok: false, error: "this tracker is invite-only", reason: join ? "code-not-invite" : typed ? "bad-invite" : "not-enrolled" };
}
