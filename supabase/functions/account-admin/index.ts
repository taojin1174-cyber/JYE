import { createAccountHandler } from './handler.js';

Deno.serve(createAccountHandler({
  url: Deno.env.get('SUPABASE_URL'),
  serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  allowedOrigins: (Deno.env.get('ALLOWED_ORIGINS') || 'https://bbroot01.bbroot.com,https://taojin1174-cyber.github.io').split(',').map(value=>value.trim()).filter(Boolean),
}));
