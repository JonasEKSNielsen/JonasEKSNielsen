import { readFile, writeFile } from "node:fs/promises";

const {
  SPOTIFY_CLIENT_ID,
  SPOTIFY_CLIENT_SECRET,
  SPOTIFY_REFRESH_TOKEN,
} = process.env;

const README_PATH = new URL("../README.md", import.meta.url);
const START = "<!-- SPOTIFY_STATS_START -->";
const END = "<!-- SPOTIFY_STATS_END -->";

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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildStatsMarkdown(tracks) {
  const formatTime = () =>
    new Date().toLocaleString("da-DK", {
      timeZone: "Europe/Copenhagen",
      hour12: false,
    });

  const cells = tracks.map((track) => {
    const img = track.album?.images?.[0]?.url ?? "";
    const name = track.name ?? "Unknown track";
    const artists = track.artists?.map((a) => a.name).join(", ") ?? "Unknown artist";
    const url = track.external_urls?.spotify ?? "https://open.spotify.com/";

    return `
<td align="center" width="33%">
  <a href="${url}">
    <img src="${img}" width="150">
  </a><br>
  <strong>${name}</strong><br>
  <em>${artists}</em>
</td>`;
  });

  const row1 = `<tr>${cells.slice(0, 3).join("")}</tr>`;
  const row2 = `<tr>${cells.slice(3, 5).join("")}</tr>`;

  return `
<table>
${row1}
${row2}
</table>

_Last updated: ${formatTime()} (Copenhagen time)_
  `.trim();
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
  const stats = buildStatsMarkdown(tracks);
  await updateReadme(stats);
  console.log("README Spotify stats updated.");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});