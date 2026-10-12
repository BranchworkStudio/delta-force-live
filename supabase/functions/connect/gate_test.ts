// node gate_test.ts  (or deno run gate_test.ts) from supabase/functions/connect; prints "gate ok".
import assert from "node:assert/strict";
import { decide } from "./gate.ts";

const invite = { kind: "invite" as const, via: "ab12", solo: false, spent: false };
const group = { kind: "group" as const, via: "group:XYZ123", solo: false, spent: false };

// Already enrolled: always through, whatever the link says, and keeps their own board setting.
assert.deepEqual(decide({ on_squad: false }, null, null, ""), { ok: true, via: null, onSquad: false });
assert.deepEqual(decide({ on_squad: null }, null, { ...invite, spent: true }, "ab12"), { ok: true, via: null, onSquad: true });
// The first hand-over on an empty deployment owns it.
assert.deepEqual(decide(null, 0, null, ""), { ok: true, via: "first", onSquad: true });
// An invite with uses left enrols; a solo one keeps them off the shared board.
assert.deepEqual(decide(null, 5, invite, "ab12"), { ok: true, via: "ab12", onSquad: true });
assert.deepEqual(decide(null, 5, { ...invite, solo: true }, "ab12"), { ok: true, via: "ab12", onSquad: false });
// Everything else is refused, each with its own reason.
assert.equal((decide(null, 5, { ...invite, spent: true }, "ab12") as any).reason, "invite-used-up");
assert.equal((decide(null, 5, group, "XYZ123") as any).reason, "code-not-invite");
assert.equal((decide(null, 5, null, "nonsense") as any).reason, "bad-invite");
assert.equal((decide(null, 5, null, "") as any).reason, "not-enrolled");
console.log("gate ok");
