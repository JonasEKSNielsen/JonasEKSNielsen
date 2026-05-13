import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const {
  SPOTIFY_CLIENT_ID,
  SPOTIFY_CLIENT_SECRET,
  SPOTIFY_REFRESH_TOKEN,
} = process.env;

const README_PATH = new URL("../README.md", import.meta.url);
const START = "<!-- SPOTIFY_STATS_START -->";
const END = "<!-- SPOTIFY_STATS_END -->";
const CARD_TEXT_COLOR = "#EDE8D5";
const FOREST_FALLBACKS = ["#2F3E2C", "#4A5F3E", "#6B4F3A", "#8C6A4A"];
const execFileAsync = promisify(execFile);

function assertEnv() {
  const missing = [
    ["SPOTIFY_CLIENT_ID", SPOTIFY_CLIENT_ID],
    ["SPOTIFY_CLIENT_SECRET", SPOTIFY_CLIENT_SECRET],
    ["SPOTIFY_REFRESH_TOKEN", SPOTIFY_REFRESH_TOKEN],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}

async function getAccessToken() {
  const basic = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString(
    "base64"
  );

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: SPOTIFY_REFRESH_TOKEN,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Spotify token request failed (${response.status}): ${text}`);
  }

  const payload = await response.json();
  return payload.access_token;
}

async function getTopTracks(accessToken) {
  const response = await fetch(
    "https://api.spotify.com/v1/me/top/tracks?time_range=long_term&limit=5",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Spotify top tracks request failed (${response.status}): ${text}`);
  }

  const payload = await response.json();
  return payload.items ?? [];
}

function formatDuration(ms) {
  const totalSeconds = Math.round((ms ?? 0) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function toHex({ r, g, b }) {
  return [r, g, b]
    .map((value) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0"))
    .join("");
}

function darkenColor({ r, g, b }) {
  return {
    r: Math.round(r * 0.45),
    g: Math.round(g * 0.45),
    b: Math.round(b * 0.45),
  };
}

async function extractDominantColor(imageUrl) {
  const response = await fetch(imageUrl);

  if (!response.ok) {
    throw new Error(`Failed to download album cover (${response.status})`);
  }

  const imageBuffer = Buffer.from(await response.arrayBuffer());
  const tempDir = await mkdtemp(join(tmpdir(), "spotify-cover-"));
  const tempFile = join(tempDir, "cover-image");

  await writeFile(tempFile, imageBuffer);

  try {
    const powershellScript = `
Add-Type -AssemblyName System.Drawing
$bitmap = [System.Drawing.Bitmap]::FromFile($args[0])
try {
  [long]$red = 0
  [long]$green = 0
  [long]$blue = 0
  [long]$samples = 0

  for ($y = 0; $y -lt $bitmap.Height; $y++) {
    for ($x = 0; $x -lt $bitmap.Width; $x++) {
      $color = $bitmap.GetPixel($x, $y)
      $red += $color.R
      $green += $color.G
      $blue += $color.B
      $samples++
    }
  }

  if ($samples -eq 0) {
    @{ r = 47; g = 62; b = 44 } | ConvertTo-Json -Compress
  } else {
    @{ r = [Math]::Round($red / $samples); g = [Math]::Round($green / $samples); b = [Math]::Round($blue / $samples) } | ConvertTo-Json -Compress
  }
}
finally {
  $bitmap.Dispose()
}
`;

    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-Command", powershellScript, tempFile],
      { windowsHide: true, maxBuffer: 1024 * 1024 }
    );

    const dominant = JSON.parse(stdout.toString().trim());
    return `#${toHex(darkenColor(dominant))}`;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function buildTrackCard(track) {
  const albumCoverUrl = track.album?.images?.[0]?.url ?? "";
  const fallbackIndex = Math.abs((track.name ?? "").length) % FOREST_FALLBACKS.length;
  const background = albumCoverUrl
    ? await extractDominantColor(albumCoverUrl)
    : FOREST_FALLBACKS[fallbackIndex];
  const trackName = track.name ?? "Unknown track";
  const artistName = track.artists?.map((artist) => artist.name).join(", ") ?? "Unknown artist";
  const duration = formatDuration(track.duration_ms);

  return `<div style="
  width: 70%;
  margin: 12px auto;
  background: ${background};
  border-radius: 14px;
  padding: 14px;
  display: flex;
  align-items: center;
  box-shadow: 0 4px 12px rgba(0,0,0,0.25);
">
  <img src="${albumCoverUrl}" width="70" style="border-radius: 10px; margin-right: 14px;" />
  <div style="color: #EDE8D5;">
    <div style="font-size: 16px; font-weight: bold;">${trackName}</div>
    <div style="font-size: 14px; opacity: 0.9;">${artistName}</div>
    <div style="font-size: 13px; opacity: 0.7;">${duration}</div>
  </div>
</div>`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function buildStatsHtml(tracks) {
  const formatTime = () =>
    new Date().toLocaleString("da-DK", {
      timeZone: "Europe/Copenhagen",
      hour12: false,
    });

  const selectedTracks = [...tracks.slice(0, 5)];

  while (selectedTracks.length < 5) {
    selectedTracks.push({
      name: "No track available",
      artists: [{ name: "Spotify" }],
      duration_ms: 0,
      album: { images: [] },
    });
  }

  const cards = [];

  for (const track of selectedTracks) {
    cards.push(await buildTrackCard(track));
  }

  return `${cards.join("\n\n")}

<div style="width: 70%; margin: 8px auto 0; text-align: center; color: ${CARD_TEXT_COLOR}; opacity: 0.75; font-size: 13px;">
  Copenhagen time: ${formatTime()}
</div>`;
}


async function updateReadme(statsBlock) {
  const readme = await readFile(README_PATH, "utf8");
  const pattern = new RegExp(`${escapeRegExp(START)}[\\s\\S]*?${escapeRegExp(END)}`);
  const replacement = `${START}\n${statsBlock}\n${END}`;

  if (!pattern.test(readme)) {
    throw new Error(`README markers not found. Expected ${START} and ${END}.`);
  }

  const nextReadme = readme.replace(pattern, replacement);
  await writeFile(README_PATH, nextReadme, "utf8");
}

async function main() {
  assertEnv();
  const token = await getAccessToken();
  const tracks = await getTopTracks(token);
  const stats = await buildStatsHtml(tracks);
  await updateReadme(stats);
  console.log("README Spotify stats updated.");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});