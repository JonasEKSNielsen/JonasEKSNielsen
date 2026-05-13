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
const FOREST_FALLBACKS = ["#2F3E2C", "#4A5F3E", "#6B4F3A", "#8C6A4A"];
const RANK_BADGES = ["#8C6A4A", "#6B8E23", "#4A5F3E", "#A37C27", "#4E6E58"];

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

function buildTrackListItem(track, rank, formattedDuration) {
  const albumCoverUrl = track.album?.images?.[0]?.url ?? "";
  const background = pickBackgroundColor(track);
  const trackName = track.name ?? "Unknown track";
  const artistName = track.artists?.map((artist) => artist.name).join(", ") ?? "Unknown artist";
  const badgeColor = RANK_BADGES[(rank - 1) % RANK_BADGES.length];

  return `<li style="
  list-style: none;
  margin: 12px 0;
  padding: 0;
">
  <div style="
    display: flex;
    align-items: center;
    gap: 14px;
    background: linear-gradient(135deg, ${background}, #243126);
    border: 1px solid rgba(237, 232, 213, 0.18);
    border-left: 8px solid ${badgeColor};
    border-radius: 18px;
    padding: 14px;
    box-shadow: 0 10px 20px rgba(0, 0, 0, 0.18);
  ">
    <div style="
      width: 42px;
      height: 42px;
      border-radius: 999px;
      background: ${badgeColor};
      color: #F4F0E6;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      font-size: 15px;
      flex: 0 0 auto;
      box-shadow: 0 4px 10px rgba(0, 0, 0, 0.2);
    ">${rank}</div>
    <img src="${albumCoverUrl}" width="72" height="72" style="border-radius: 14px; object-fit: cover; flex: 0 0 auto;" />
    <div style="color: #EDE8D5; min-width: 0; flex: 1;">
      <div style="font-size: 16px; font-weight: 700; line-height: 1.25; margin-bottom: 4px;">${escapeHtml(trackName)}</div>
      <div style="font-size: 14px; opacity: 0.92; margin-bottom: 6px;">${escapeHtml(artistName)}</div>
      <div style="display: inline-flex; align-items: center; gap: 8px; font-size: 12px; opacity: 0.9; background: rgba(0, 0, 0, 0.16); padding: 4px 10px; border-radius: 999px;">
        <span>Duration</span>
        <span>${formattedDuration}</span>
      </div>
    </div>
  </div>
</li>`;
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

  for (const [index, track] of selectedTracks.entries()) {
    const rank = index + 1;
    const duration = formatDuration(track.duration_ms);
    cards.push(buildTrackListItem(track, rank, duration));
  }

  return `<ol style="padding: 0; margin: 0; width: 100%; max-width: 860px;">
${cards.join("\n")}
</ol>

<div style="width: 100%; max-width: 860px; margin: 10px auto 0; text-align: center; color: ${CARD_TEXT_COLOR}; opacity: 0.78; font-size: 13px;">
  Updated in Copenhagen time: ${formatTime()}
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