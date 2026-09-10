// Filled in at build time / by hand. The anon key is public by design (Supabase RLS protects the data).
export const CONFIG = {
  SUPABASE_URL: "https://faaskhwycywnwpdjcvgp.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_Q75-W62B_ozzlnFPV61cqA_V9k7MOMX",
  SITE_URL: "https://branchworkstudio.github.io/delta-force-live/",
  POLL_MINUTES: 1,
  BACKFILL_PAGES: 15,      // how many pages (x20 matches) of history to import per mode on first run
  PAGE_SIZE: 20
};
