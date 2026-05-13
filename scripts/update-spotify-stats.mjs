import { readFile, writeFile } from "node:fs/promises";

const {
  SPOTIFY_CLIENT_ID,
  SPOTIFY_CLIENT_SECRET,
  SPOTIFY_REFRESH_TOKEN,
} = process.env;

const README_PATH = new URL("../README.md", import.meta.url);
const START = "<!-- SPOTIFY_STATS_START -->";
const END = "<!-- SPOTIFY_STATS_END -->";
const CARD_TEXT_COLOR = "#EDE8D5";
const FOREST_FALLBACKS = ["#31422D", "#415437", "#5D7043", "#7C5C42"];
const RANK_BADGES = ["#6B8E23", "#59743A", "#4A5F3E", "#8C6A4A", "#A37C27"];

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

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function hashString(value) {
  let hash = 0;

  for (let index = 0; index < value.length; index++) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash;
}

function pickBackgroundColor(track) {
  const artistName = track.artists?.map((artist) => artist.name).join(", ") ?? "";
  const seed = `${track.name ?? "Unknown track"}|${artistName}|${track.album?.name ?? ""}`;
  const fallbackIndex = hashString(seed) % FOREST_FALLBACKS.length;
  return FOREST_FALLBACKS[fallbackIndex];
}

function buildSpotifyTableCell(track, cellWidth) {
  const albumCoverUrl = track.album?.images?.[0]?.url ?? "";
  const trackName = track.name ?? "Unknown track";
  const artistName = track.artists?.map((artist) => artist.name).join(", ") ?? "Unknown artist";

  return `<td align="center" width="${cellWidth}" style="width: ${cellWidth}; padding: 10px; vertical-align: top;">
  <img src="${albumCoverUrl}" width="150" style="max-width: 100%; height: auto;" alt="${escapeHtml(trackName)}" />
  <br/>
  <strong>${escapeHtml(trackName)}</strong>
  <br/>
  <sub>${escapeHtml(artistName)}</sub>
</td>`;
}

function buildFallbackTrack() {
  return {
    name: "No track available",
    artists: [{ name: "Spotify" }],
    duration_ms: 0,
    album: { images: [] },
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function buildStatsHtml(tracks) {
  const selectedTracks = [...tracks.slice(0, 5)];

  while (selectedTracks.length < 5) {
    selectedTracks.push(buildFallbackTrack());
  }

  const topThree = selectedTracks.slice(0, 3);
  const bottomTwo = selectedTracks.slice(3, 5);

  return `<table width="100%" style="width: 100%; table-layout: fixed; border-collapse: collapse;">
  <tr>
${topThree.map((track) => buildSpotifyTableCell(track, "33.33%")).join("\n")}
  </tr>

  <tr>
    <td colspan="3" align="center" style="padding-top: 12px;">
      <table width="66%" style="width: 66%; table-layout: fixed; border-collapse: collapse; margin: 0 auto;">
        <tr>
${bottomTwo.map((track) => buildSpotifyTableCell(track, "50%")).join("\n")}
        </tr>
      </table>
    </td>
  </tr>
</table>`;
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