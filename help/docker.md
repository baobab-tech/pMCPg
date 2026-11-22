---
title: Use pMCPg in Docker
summary: Run pMCPg in a container on a server or a shared machine, with the master key kept outside the data volume.
group: security
order: 3
---
For a team server or a machine without a desktop. On a laptop, the normal install is simpler.

## Pick an image

| Tag | Runs |
|---|---|
| `slim` | Online servers only. Smallest |
| `full` | Online servers and commands such as `npx` and `uvx` |

## Steps

1. Create a master key, outside any folder you mount as data:

   ```
   openssl rand -base64 32 > pmcpg_master_key
   chmod 600 pmcpg_master_key
   ```

2. Use the `compose.yaml` in `packaging/docker/` of the project. It passes the key with `PMCPG_MASTER_KEY_FILE`, keeps data in a `/data` volume, and publishes port 7431 on `127.0.0.1` only.
3. `docker compose up -d`.
4. Open `http://127.0.0.1:7431`. The first time, the page asks for a one-time setup code: find it with `docker compose logs`. Then set a password; Docker requires one.

## Keep the key safe

Docker has no system keychain, so the master key is the file you made. Keep a copy somewhere safe and separate from your data backups. **Losing it means losing every stored key and sign-in.**

## Reaching it from other machines

Publishing the port beyond `127.0.0.1` makes the page reachable on your network. Put it behind HTTPS and keep the password strong.

## Sign-ins

Browser sign-ins return to `http://127.0.0.1:7431/oauth/callback`. Open the page from the same machine, or through an SSH tunnel, when you sign in.
