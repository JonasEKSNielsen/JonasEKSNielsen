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

function buildTrackPodiumCard(track, rank, formattedDuration, placement) {
  const albumCoverUrl = track.album?.images?.[0]?.url ?? "";
  const background = pickBackgroundColor(track);
  const trackName = track.name ?? "Unknown track";
  const artistName = track.artists?.map((artist) => artist.name).join(", ") ?? "Unknown artist";
  const badgeColor = RANK_BADGES[(rank - 1) % RANK_BADGES.length];
  const minHeight = placement === "top" ? (rank === 1 ? "248px" : "226px") : "208px";
  const lift = rank === 1 ? "transform: translateY(-8px);" : "";
  const shadow = rank === 1 ? "box-shadow: 0 18px 32px rgba(0, 0, 0, 0.28);" : "box-shadow: 0 12px 22px rgba(0, 0, 0, 0.22);";

  return `<div style="
  min-height: ${minHeight};
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  background: linear-gradient(180deg, #1F2430, #161B23);
  border: 1px solid rgba(237, 232, 213, 0.14);
  border-bottom: 10px solid ${badgeColor};
  border-radius: 22px;
  padding: 16px;
  overflow: hidden;
  ${shadow}
  ${lift}
">
  <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 14px;">
    <div style="
      width: 38px;
      height: 38px;
      border-radius: 999px;
      background: ${badgeColor};
      color: #F4F0E6;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      font-size: 15px;
      box-shadow: 0 4px 10px rgba(0, 0, 0, 0.2);
      flex: 0 0 auto;
    ">${rank}</div>
    <div style="
      flex: 1;
      min-height: 88px;
      border-radius: 18px;
      background: rgba(0, 0, 0, 0.16);
      border: 1px solid rgba(237, 232, 213, 0.12);
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      position: relative;
    ">
      <img src="${albumCoverUrl}" width="88" height="88" style="object-fit: cover; width: 100%; height: 100%;" />
      <div style="position: absolute; inset: 0; background: linear-gradient(180deg, rgba(0,0,0,0) 55%, rgba(0,0,0,0.28) 100%);"></div>
    </div>
  </div>

  <div style="color: #EDE8D5; min-width: 0;">
    <div style="font-size: 16px; font-weight: 700; line-height: 1.25; margin-bottom: 6px;">${escapeHtml(trackName)}</div>
    <div style="font-size: 13px; opacity: 0.9; margin-bottom: 10px;">${escapeHtml(artistName)}</div>
    <div style="display: inline-flex; align-items: center; gap: 8px; font-size: 12px; color: #F4F0E6; background: rgba(0, 0, 0, 0.18); border: 1px solid rgba(237, 232, 213, 0.12); padding: 8px 12px; border-radius: 999px; white-space: nowrap;">
      <span>Duration</span>
      <span>${formattedDuration}</span>
    </div>
  </div>
</div>`;
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
  const formatTime = () =>
    new Date().toLocaleString("da-DK", {
      timeZone: "Europe/Copenhagen",
      hour12: false,
    });

  const selectedTracks = [...tracks.slice(0, 5)];

  while (selectedTracks.length < 5) {
    selectedTracks.push(buildFallbackTrack());
  }

  const topThree = selectedTracks.slice(0, 3);
  const bottomTwo = selectedTracks.slice(3, 5);

  return `<div style="
  width: 100%;
  max-width: 980px;
  margin: 0 auto;
  padding: 16px;
  border-radius: 24px;
  background: linear-gradient(180deg, #1A1F28, #11151C);
  border: 1px solid rgba(237, 232, 213, 0.12);
  box-shadow: 0 18px 36px rgba(0, 0, 0, 0.25);
">
  <div style="display: flex; align-items: end; justify-content: space-between; gap: 12px; margin-bottom: 14px; flex-wrap: wrap;">
    <div>
      <div style="color: #F4F0E6; font-size: 20px; font-weight: 800; line-height: 1.2;">Spotify Top 5</div>
      <div style="color: ${CARD_TEXT_COLOR}; opacity: 0.78; font-size: 13px; margin-top: 4px;">Your most listened to tracks, laid out like a podium</div>
    </div>
    <div style="
      color: #F4F0E6;
      background: rgba(0, 0, 0, 0.18);
      border: 1px solid rgba(237, 232, 213, 0.12);
      padding: 8px 12px;
      border-radius: 999px;
      font-size: 12px;
      white-space: nowrap;
    ">Updated in Copenhagen time: ${formatTime()}</div>
  </div>

  <div style="display: grid; gap: 14px;">
    <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; align-items: end;">
${topThree
  .map((track, index) => buildTrackPodiumCard(track, index + 1, formatDuration(track.duration_ms), "top"))
  .join("\n")}
    </div>

    <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; max-width: 620px; margin: 0 auto; align-items: end;">
${bottomTwo
  .map((track, index) => buildTrackPodiumCard(track, index + 4, formatDuration(track.duration_ms), "bottom"))
  .join("\n")}
    </div>
  </div>

  <div style="margin-top: 14px; text-align: center; color: ${CARD_TEXT_COLOR}; opacity: 0.72; font-size: 13px;">
    Last updated in Copenhagen time: ${formatTime()}
  </div>
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