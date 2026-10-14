// Edge Function nunu-riot – startpunkt i Supabase (Deno).
// All logik ligger i .mjs-filerna bredvid och testas i Node.
//
// Hemligheter (Supabase → Edge Functions → Secrets):
//   RIOT_API_KEY      Riot-nyckeln (krävs)
//   NUNU_SERVICE_KEY  valfri: egen sb_secret_-nyckel om SUPABASE_SERVICE_ROLE_KEY saknas
// SUPABASE_URL och SUPABASE_SERVICE_ROLE_KEY sätts automatiskt av Supabase.
import { createHandler, createGetUser } from './handler.mjs';
import { createRiot } from './riot.mjs';
import { createDb } from './db.mjs';

const url = Deno.env.get('SUPABASE_URL') ?? '';
const serviceKey = Deno.env.get('NUNU_SERVICE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const handler = createHandler({
  getUser: createGetUser({ url, apiKey: serviceKey }),
  makeDeps: () => ({
    riot: createRiot({ apiKey: Deno.env.get('RIOT_API_KEY') ?? '' }),
    db: createDb({ url, serviceKey }),
  }),
});

Deno.serve(handler);
