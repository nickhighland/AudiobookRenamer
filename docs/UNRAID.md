**Running AudiobookRenamer on Unraid**

This file gives two easy options to run the API/backend on Unraid: Docker Compose or the Community Applications template.

1) Docker Compose (recommended if you use the Compose plugin)

Create a folder (for example `/mnt/user/appdata/audiobookrenamer`) and copy `docker/unraid/docker-compose.unraid.yml` there. Edit paths and ports as needed.

Usage (via Unraid terminal or Compose plugin):

```bash
cd /mnt/user/appdata/audiobookrenamer
OPENAI_API_KEY="sk-..." GOOGLE_BOOKS_API_KEY="..." docker compose -f docker-compose.unraid.yml up -d
```

Notes:
- The example maps `/mnt/user/media/audiobooks` to `/audiobooks` inside the container — update to match your shares.
- Port `4033` is used in the example (this matches the API container default).
- If your workflow uses ffmpeg for embedding covers/metadata, ensure the Docker image includes `ffmpeg` or mount a host ffmpeg binary into the container.

2) Community Applications template

Import the provided `docker/unraid/unraid-template.xml` into Community Applications (Advanced → Import Template) or use it as reference to create a new container via the UI.

Template improvements included:
- Uses fixed image tag `nickhighland/audiobookrenamer:0.1.2` (you can change to `:latest` later if you prefer).
- Sets correct default WebUI/API port (`4033`).
- Marks `OPENAI_API_KEY` as required and masked.
- Includes advanced environment options: `GOOGLE_BOOKS_API_KEY`, `PORT`, `NODE_ENV`, `TZ`.
- Includes project/support metadata for easier maintenance.

Key settings to configure in the Unraid UI:
- Repository: `nickhighland/audiobookrenamer:0.1.2` (recommended) or `nickhighland/audiobookrenamer:latest`
- Network Type: `bridge` (or host if you prefer)
- Host Ports: map host `4033` → container `4033` (or keep container `4033` and use another host port)
- WebUI: use `http://[IP]:[PORT:4033]/` for the browser frontend (`/health` remains available for health checks)
- Volumes: map an AppData path (e.g., `/mnt/user/appdata/audiobookrenamer` → `/app/data`) and your audiobooks share (e.g., `/mnt/user/media/audiobooks` → `/audiobooks`)
- Environment Variables: set `OPENAI_API_KEY`, optionally `GOOGLE_BOOKS_API_KEY` and any provider keys you use.

Troubleshooting & tips
- If embedding fails due to missing `ffmpeg`, either rebuild the image to include `ffmpeg` or run a helper container with `ffmpeg` and share files via a common mount.
- Permissions: ensure the container user has read/write access to the mapped audio share and the `appdata` folder.
- Logs: check container logs in Unraid (Docker → Logs) to diagnose startup problems.

If you want, I can:
- Add a small verification endpoint to confirm embedding capability and write a UI button to call it from the desktop app.
