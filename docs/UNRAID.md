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
- Port `3000` is used in the example. Change it if your build uses a different port.
- If your workflow uses ffmpeg for embedding covers/metadata, ensure the Docker image includes `ffmpeg` or mount a host ffmpeg binary into the container.

2) Community Applications template

Import the provided `docker/unraid/unraid-template.xml` into Community Applications (Advanced → Import Template) or use it as reference to create a new container via the UI.

Key settings to configure in the Unraid UI:
- Repository: `nickhighland/audiobookrenamer`
- Network Type: `bridge` (or host if you prefer)
- Host Ports: map host `3000` → container `3000` (or whichever port your API listens on)
- Volumes: map an AppData path (e.g., `/mnt/user/appdata/audiobookrenamer` → `/app/data`) and your audiobooks share (e.g., `/mnt/user/media/audiobooks` → `/audiobooks`)
- Environment Variables: set `OPENAI_API_KEY`, optionally `GOOGLE_BOOKS_API_KEY` and any provider keys you use.

Troubleshooting & tips
- If embedding fails due to missing `ffmpeg`, either rebuild the image to include `ffmpeg` or run a helper container with `ffmpeg` and share files via a common mount.
- Permissions: ensure the container user has read/write access to the mapped audio share and the `appdata` folder.
- Logs: check container logs in Unraid (Docker → Logs) to diagnose startup problems.

If you want, I can:
- Add a minimal healthcheck to the Docker image and the compose file.
- Add a small verification endpoint to confirm embedding capability and write a UI button to call it from the desktop app.
