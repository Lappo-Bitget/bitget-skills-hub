# Morph Agent ID Pages proxy

This directory contains the Cloudflare Pages Function used by the shared Bitget Wallet Morph Swap proxy.

Deploy from this directory with Wrangler, for example:

```powershell
npx wrangler pages deploy . --project-name morph-agent-id --commit-dirty=true
```

Configure `BGW_API_KEY` and `BGW_API_SECRET` as Cloudflare Pages production Secrets. Never commit their values.
