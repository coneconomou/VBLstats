// What the NBL1 proxies (serve.js locally, worker/nbl1-proxy.js online) allow and how they call NBL1.
// NBL1's stats API only answers requests that say they come from nbl1.com.au (browsers block it from
// anywhere else), so the proxy adds that origin. Agreed with the owner as a workaround; it may break if
// NBL1 changes their API.
export const ROSETTA = 'https://prod.rosetta.nbl.com.au/get/';
export const ROSETTA_HEADERS = { Origin: 'https://www.nbl1.com.au', Referer: 'https://www.nbl1.com.au/', 'User-Agent': 'Mozilla/5.0' };

// The exact endpoints the app uses, matched whole, so "../" tricks can't reach anything else.
export const ALLOWED = [
  /^nbl1\/seasons$/,
  /^nbl1\/matches\/in\/season\/\d{4}\/regular\/[a-z]+$/,
  /^nbl1\/standings\/\d{4}\/regular$/,
  /^match\/[0-9a-f-]{36}\/live\/all$/,
];
export const isAllowed = (path) => ALLOWED.some((re) => re.test(path));

export const MEMO_MS = 5 * 60 * 1000; // matches the API's own cache time

// A full match is ~1 MB, almost all play-by-play and video data the app never uses.
export function slimMatch(json) {
  const drop = ['play_by_play', 'match_video', 'calculated_player_statistics', 'calculated_team_statistics', 'betting', 'odds'];
  for (const m of json.data ?? []) for (const k of drop) delete m[k];
  return json;
}

export const isValidResponse = (json) => json && Array.isArray(json.data);
export const isFinishedMatch = (path, json) => path.startsWith('match/') && json.data[0]?.match_status === 'complete';
