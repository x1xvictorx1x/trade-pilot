Trade Pilot Alpha Security Checklist

Supabase Auth
- Keep email confirmation enabled.
- Enable leaked password protection in Auth password security.
- Set site URL to https://tradepilottool.com.
- Add https://tradepilottool.com to allowed redirect URLs.

Frontend
- Use only public Supabase browser keys in Vite environment variables.
- Never expose service role keys or broker credentials in browser code.

Broker Connections
- Keep broker integrations read-only.
- Store future broker tokens server-side only.
- Do not add order placement, order cancellation, or order modification before legal review, audit logs, and manual confirmation are in place.
