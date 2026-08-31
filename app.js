// app.js - orchestration, rendering, standings, polling.

const DEFAULT_LEAGUE_ID = '1387827434572754944';
const LIVE_POLL_MS = 30000;

const state = {
  leagueId: null,
  league: null,
  users: [],
  rosters: [],
  realRosters: [],
  medianRoster: null,
  rosterMeta: {}, // roster_id -> { name, avatarUrl, ownerId }
  season: null,
  currentStateWeek: 1,
  playoffWeekStart: 14,
  selectedWeek: 1,
  weekData: null, // populated by loadWeekData
  standingsCache: null, // { throughWeek, rows, medianRow }
  recordsByRoster: {}, // roster_id -> { wins, losses, ties, seed } (seed null for median)
  pollTimer: null,
  activeTab: 'scoreboard',
};

// ---------------------------------------------------------------- helpers

function el(id) {
  return document.getElementById(id);
}

function fmtPts(n) {
  return (Math.round((n || 0) * 100) / 100).toFixed(2);
}

function avatarUrlFor(user) {
  const meta = user && user.metadata;
  if (meta && meta.avatar) return meta.avatar;
  if (user && user.avatar) return `https://sleepercdn.com/avatars/thumbs/${user.avatar}`;
  return null;
}

function getLeagueId() {
  return localStorage.getItem('smt:leagueId') || DEFAULT_LEAGUE_ID;
}

function setLeagueId(id) {
  localStorage.setItem('smt:leagueId', id);
}

// ------------------------------------------------------------ league load

async function loadLeagueMeta() {
  state.leagueId = getLeagueId();
  const [league, users, rosters, nflState] = await Promise.all([
    getLeague(state.leagueId),
    getUsers(state.leagueId),
    getRosters(state.leagueId),
    getState(),
  ]);

  state.league = league;
  state.users = users;
  state.rosters = rosters;
  state.season = league.season;
  state.playoffWeekStart = (league.settings && league.settings.playoff_week_start) || 14;

  const { medianRoster, realRosters } = splitRosters(rosters);
  state.medianRoster = medianRoster;
  state.realRosters = realRosters;

  const usersById = {};
  for (const u of users) usersById[u.user_id] = u;

  const meta = {};
  for (const r of rosters) {
    if (r.owner_id && usersById[r.owner_id]) {
      const u = usersById[r.owner_id];
      meta[r.roster_id] = {
        name: (u.metadata && u.metadata.team_name) || u.display_name || `Team ${r.roster_id}`,
        avatarUrl: avatarUrlFor(u),
        ownerId: r.owner_id,
        handle: u.display_name ? `@${u.display_name}` : null,
      };
    } else {
      meta[r.roster_id] = { name: 'Median', avatarUrl: null, ownerId: null, handle: null };
    }
  }
  state.rosterMeta = meta;

  // Default week: current NFL week if this league's season matches, clamped
  // to the regular season (median logic doesn't apply once playoffs start).
  let defaultWeek = 1;
  if (nflState && String(nflState.season) === String(league.season)) {
    defaultWeek = nflState.week || 1;
  }
  state.currentStateWeek = defaultWeek;
  defaultWeek = Math.max(1, Math.min(defaultWeek, state.playoffWeekStart - 1));
  state.selectedWeek = defaultWeek;

  el('leagueTitle').textContent = league.name || 'League';
  el('leagueSeason').textContent = `${league.season} Season`;

  populateWeekSelect();
}

function populateWeekSelect() {
  const sel = el('weekSelect');
  sel.innerHTML = '';
  const lastWeek = Math.max(1, state.playoffWeekStart - 1);
  for (let w = 1; w <= lastWeek; w++) {
    const opt = document.createElement('option');
    opt.value = String(w);
    opt.textContent = `Week ${w}`;
    if (w === state.selectedWeek) opt.selected = true;
    sel.appendChild(opt);
  }
}

// -------------------------------------------------------------- week load

async function loadWeekData(week) {
  const leagueId = state.leagueId;
  const season = state.season;
  const isFinal = week < state.currentStateWeek;

  const matchupEntries = await getMatchups(leagueId, week, { isFinal });
  const gameInfoByTeam = await getGameInfoByTeam(season, week).catch(() => ({}));
  const gameStatusByTeam = {};
  for (const team in gameInfoByTeam) gameStatusByTeam[team] = gameInfoByTeam[team].state;

  // Pull full rosters (not just starters) so the Bench section has data too.
  const neededPlayerIds = new Set();
  for (const e of matchupEntries) {
    for (const pid of e.players || e.starters || []) {
      if (pid && pid !== '0') neededPlayerIds.add(pid);
    }
  }
  const players = await getPlayersTrimmed([...neededPlayerIds]);

  let projectionPointsMap = {};
  try {
    const rawProj = await getProjectionsRaw(season, week);
    const relevant = rawProj.filter((e) => neededPlayerIds.has(e.player_id));
    projectionPointsMap = buildProjectionPointsMap(relevant, state.league.scoring_settings);
  } catch (e) {
    console.warn('projections unavailable', e);
  }

  let actualStatsMap = {};
  try {
    const rawStats = await getStatsRaw(season, week, { isFinal });
    for (const e of rawStats) {
      if (neededPlayerIds.has(e.player_id)) actualStatsMap[e.player_id] = e.stats;
    }
  } catch (e) {
    console.warn('stats unavailable', e);
  }

  const medianRosterId = state.medianRoster ? state.medianRoster.roster_id : null;
  const medianResult = medianRosterId
    ? computeMedianForWeek({
        matchupEntries,
        medianRosterId,
        players,
        gameStatusByTeam,
        projectionPointsMap,
      })
    : null;

  state.weekData = {
    week,
    matchupEntries,
    groups: groupMatchups(matchupEntries),
    gameInfoByTeam,
    gameStatusByTeam,
    players,
    projectionPointsMap,
    actualStatsMap,
    medianResult,
  };
}

// -------------------------------------------------------------- rendering

function rosterName(rosterId) {
  const m = state.rosterMeta[rosterId];
  return m ? m.name : `Team ${rosterId}`;
}

function rosterAvatar(rosterId) {
  const m = state.rosterMeta[rosterId];
  return m && m.avatarUrl;
}

function avatarEl(rosterId, isMedian, sizeClass) {
  const url = rosterAvatar(rosterId);
  const cls = `avatar ${sizeClass || ''}`.trim();
  if (url) {
    const img = document.createElement('img');
    img.className = cls;
    img.src = url;
    img.alt = '';
    return img;
  }
  const div = document.createElement('div');
  div.className = cls + ' avatar-fallback' + (isMedian ? ' avatar-median' : '');
  div.textContent = isMedian ? 'μ' : rosterName(rosterId).slice(0, 1).toUpperCase();
  return div;
}

function trackedTeamAsMedianEntry(trackedRosterId) {
  const wd = state.weekData;
  for (const [, entries] of wd.groups) {
    for (const e of entries) {
      if (e.roster_id === trackedRosterId) return e;
    }
  }
  return null;
}

function isMatchupFullyFinal(entryA, entryB) {
  const gi = state.weekData.gameInfoByTeam;
  const players = state.weekData.players;
  const allFinal = (entry) =>
    (entry.starters || []).every((pid) => {
      const p = players[pid];
      const info = p && p.team && gi[p.team];
      return !info || info.state === 'final'; // no game info = bye, treat as settled
    });
  return allFinal(entryA) && allFinal(entryB);
}

function winShare(a, b) {
  const sum = a + b;
  if (sum <= 0) return 50;
  return Math.round((100 * a) / sum);
}

// Build the { name, avatar, score, proj, sub, trophy } descriptor for one
// side of a matchup header - shared by the scoreboard card and the modal.
function sideDescriptor(entry, isMedian, mr, isLeftSide) {
  const rosterId = entry.roster_id;
  if (isMedian) {
    const trackedName = mr.trackedRosterId ? rosterName(mr.trackedRosterId) : '—';
    return {
      rosterId,
      isMedian: true,
      name: 'Median',
      avatarNode: avatarEl(rosterId, true, 'avatar-lg'),
      score: mr.medianLiveScore,
      proj: mr.medianBlendedScore,
      sub: `tracking ${trackedName}`,
    };
  }
  const rec = state.recordsByRoster[rosterId];
  const recordText = rec ? `${recordStr(rec)}${rec.seed ? ` (#${rec.seed})` : ''}` : '';
  const handle = (state.rosterMeta[rosterId] && state.rosterMeta[rosterId].handle) || '';
  const bits = [handle, recordText].filter(Boolean);
  const sub = isLeftSide ? bits.join(' · ') : bits.slice().reverse().join(' · ');
  const blended = mr && mr.ranking ? mr.ranking.find((r) => r.roster_id === rosterId) : null;
  return {
    rosterId,
    isMedian: false,
    name: rosterName(rosterId),
    avatarNode: avatarEl(rosterId, false, 'avatar-lg'),
    score: entry.points,
    proj: blended ? blended.blended : entry.points,
    sub,
  };
}

function buildMatchupHeader(leftDesc, rightDesc, isMedianMatchup, isFullyFinal) {
  const header = document.createElement('div');
  header.className = 'matchup-header';

  const leftPct = winShare(leftDesc.proj, rightDesc.proj);
  const rightPct = 100 - leftPct;
  const leftLeading = leftPct >= rightPct;
  const leftWonFinal = isFullyFinal && leftDesc.score >= rightDesc.score;

  function scoreCol(desc, pct, leading, side) {
    const col = document.createElement('div');
    col.className = `score-col score-col-${side}`;
    const big = document.createElement('div');
    big.className = 'score-big';
    big.textContent = fmtPts(desc.score);
    const proj = document.createElement('div');
    proj.className = 'score-proj';
    proj.textContent = fmtPts(desc.proj);
    const bar = document.createElement('div');
    bar.className = 'winbar';
    const fill = document.createElement('div');
    fill.className = 'winbar-fill ' + (leading ? 'winbar-lead' : 'winbar-trail');
    fill.style.width = pct + '%';
    bar.appendChild(fill);
    const pctLabel = document.createElement('div');
    pctLabel.className = 'winbar-label ' + (leading ? 'winbar-lead-text' : 'winbar-trail-text');
    pctLabel.textContent = `${pct}%`;
    col.appendChild(big);
    col.appendChild(proj);
    col.appendChild(bar);
    col.appendChild(pctLabel);
    return col;
  }

  function avatarWrap(desc, won) {
    const wrap = document.createElement('div');
    wrap.className = 'avatar-wrap';
    wrap.appendChild(desc.avatarNode);
    if (won) {
      const trophy = document.createElement('span');
      trophy.className = 'trophy-badge';
      trophy.textContent = '🏆';
      wrap.appendChild(trophy);
    }
    return wrap;
  }

  header.appendChild(avatarWrap(leftDesc, leftWonFinal));
  header.appendChild(scoreCol(leftDesc, leftPct, leftLeading, 'left'));
  const vs = document.createElement('div');
  vs.className = 'vs-badge';
  vs.textContent = 'VS';
  header.appendChild(vs);
  header.appendChild(scoreCol(rightDesc, rightPct, !leftLeading, 'right'));
  header.appendChild(avatarWrap(rightDesc, isFullyFinal && !leftWonFinal));

  const teams = document.createElement('div');
  teams.className = 'matchup-teams';
  const leftMeta = document.createElement('div');
  leftMeta.className = 'team-meta team-meta-left';
  leftMeta.innerHTML = `<div class="team-name">${leftDesc.name}</div><div class="team-sub">${leftDesc.sub}</div>`;
  const rightMeta = document.createElement('div');
  rightMeta.className = 'team-meta team-meta-right';
  rightMeta.innerHTML = `<div class="team-name">${rightDesc.name}</div><div class="team-sub">${rightDesc.sub}</div>`;
  teams.appendChild(leftMeta);
  teams.appendChild(rightMeta);

  const wrap = document.createElement('div');
  wrap.appendChild(header);
  wrap.appendChild(teams);
  return wrap;
}

function renderScoreboard() {
  const grid = el('scoreboardGrid');
  grid.innerHTML = '';
  const wd = state.weekData;
  if (!wd) return;

  el('weekHeading').textContent = `Week ${wd.week}`;

  const medianRosterId = state.medianRoster ? state.medianRoster.roster_id : null;
  const mr = wd.medianResult;

  for (const [matchupId, entries] of wd.groups) {
    if (entries.length < 2) continue;
    const isMedianMatchup = mr && matchupId === mr.medianMatchupId;
    const [a, b] = entries;
    const card = document.createElement('div');
    card.className = 'matchup-card' + (isMedianMatchup ? ' matchup-card-median' : '');

    const leftDesc = sideDescriptor(a, isMedianMatchup && a.roster_id === medianRosterId, mr, true);
    const rightDesc = sideDescriptor(b, isMedianMatchup && b.roster_id === medianRosterId, mr, false);
    const fullyFinal = isMatchupFullyFinal(a, b);
    card.appendChild(buildMatchupHeader(leftDesc, rightDesc, isMedianMatchup, fullyFinal));

    card.addEventListener('click', () => openMatchupModal(matchupId));
    grid.appendChild(card);
  }
}

// ----------------------------------------------------------------- modal

function startSlotLabels() {
  return (state.league.roster_positions || []).filter((p) => p !== 'BN' && p !== 'IR' && p !== 'TAXI');
}

function injuryTag(status) {
  if (!status) return null;
  const map = {
    Questionable: { text: 'QUES', cls: 'tag-warn' },
    Doubtful: { text: 'DOUB', cls: 'tag-warn' },
    Out: { text: 'OUT', cls: 'tag-bad' },
    IR: { text: 'IR', cls: 'tag-bad' },
    PUP: { text: 'PUP', cls: 'tag-bad' },
    Suspended: { text: 'SUS', cls: 'tag-bad' },
  };
  return map[status] || null;
}

function formatKickoff(dateTime) {
  if (!dateTime) return '';
  const d = new Date(dateTime);
  if (isNaN(d.getTime())) return '';
  const day = d.toLocaleDateString(undefined, { weekday: 'short' });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${day} ${time}`;
}

// { text, cls } line under a player's meta row, e.g. "Final L 15-24 vs CHI".
function gameResultInfo(teamAbbr) {
  const info = state.weekData.gameInfoByTeam[teamAbbr];
  if (!info) return { text: 'BYE', cls: '' };
  const oppText = `${info.isHome ? 'vs' : '@'} ${info.opp}`;
  if (info.state === 'pre') {
    return { text: `${formatKickoff(info.dateTime)} ${oppText}`, cls: '' };
  }
  if (info.state === 'live') {
    const q = info.quarter ? `Q${info.quarter}` : 'Live';
    return { text: `${q} ${info.clock || ''} ${oppText}`, cls: 'result-live' };
  }
  const win = info.teamScore > info.oppScore;
  const tie = info.teamScore === info.oppScore;
  const wl = tie ? 'T' : win ? 'W' : 'L';
  return {
    text: `Final ${wl} ${info.teamScore}-${info.oppScore} ${oppText}`,
    cls: tie ? '' : win ? 'result-w' : 'result-l',
  };
}

function playerName(pid) {
  const p = state.weekData.players[pid];
  if (!p) return pid;
  if (p.position === 'DEF') return `${p.last_name} D/ST`;
  return `${(p.first_name || '').slice(0, 1)}${p.first_name ? '. ' : ''}${p.last_name || ''}`.trim();
}

function playerMetaLine(pid) {
  const p = state.weekData.players[pid];
  if (!p) return '';
  const bye = ''; // bye-week number isn't in our trimmed player cache
  return `${p.position} · ${p.team || 'FA'}${bye}`;
}

function buildPlayerCell(pid, side, entry) {
  const cell = document.createElement('div');
  cell.className = `player-side player-side-${side}`;
  if (!pid) {
    cell.innerHTML = '<div class="player-empty">Empty</div>';
    return cell;
  }
  const p = state.weekData.players[pid] || {};
  const bigScore = (entry && entry.players_points && entry.players_points[pid]) || 0;
  const projScore = state.weekData.projectionPointsMap[pid] || 0;

  const topline = document.createElement('div');
  topline.className = 'player-topline';
  const nameEl = document.createElement('div');
  nameEl.className = 'player-name';
  nameEl.textContent = playerName(pid);
  const scoreBlock = document.createElement('div');
  scoreBlock.className = 'player-scoreblock';
  scoreBlock.innerHTML = `<div class="player-score">${fmtPts(bigScore)}</div><div class="player-proj">${fmtPts(
    projScore
  )}</div>`;
  if (side === 'left') {
    topline.appendChild(nameEl);
    topline.appendChild(scoreBlock);
  } else {
    topline.appendChild(scoreBlock);
    topline.appendChild(nameEl);
  }
  cell.appendChild(topline);

  const meta = document.createElement('div');
  meta.className = 'player-meta';
  meta.textContent = playerMetaLine(pid);
  const tag = injuryTag(p.injury_status);
  if (tag) {
    const tagEl = document.createElement('span');
    tagEl.className = `injury-tag ${tag.cls}`;
    tagEl.textContent = tag.text;
    meta.appendChild(document.createTextNode(' '));
    meta.appendChild(tagEl);
  }
  cell.appendChild(meta);

  if (p.team) {
    const result = gameResultInfo(p.team);
    const resultEl = document.createElement('div');
    resultEl.className = `player-result ${result.cls}`;
    resultEl.textContent = result.text;
    cell.appendChild(resultEl);

    const stats = state.weekData.actualStatsMap[pid];
    if (stats) {
      const line = statLine(p.position, stats);
      if (line) {
        const lineEl = document.createElement('div');
        lineEl.className = 'player-statline';
        lineEl.textContent = line;
        cell.appendChild(lineEl);
      }
    }
  }

  return cell;
}

function buildPlayerRow(pidLeft, pidRight, badgeText, entryLeft, entryRight) {
  const row = document.createElement('div');
  row.className = 'player-row';
  row.appendChild(buildPlayerCell(pidLeft, 'left', entryLeft));
  const badge = document.createElement('div');
  badge.className = 'pos-badge';
  badge.style.background = positionColor(badgeText);
  badge.textContent = badgeText;
  row.appendChild(badge);
  row.appendChild(buildPlayerCell(pidRight, 'right', entryRight));
  return row;
}

function summarizePositions(pidList) {
  const order = [];
  const counts = {};
  for (const pid of pidList) {
    const p = state.weekData.players[pid];
    const pos = (p && p.position) || '?';
    if (!(pos in counts)) order.push(pos);
    counts[pos] = (counts[pos] || 0) + 1;
  }
  return order.map((pos) => (counts[pos] > 1 ? `${counts[pos]} ${pos}` : pos)).join(', ');
}

function yetToPlayRow(entryLeft, entryRight) {
  const gi = state.weekData.gameInfoByTeam;
  const notStarted = (entry) =>
    (entry.starters || []).filter((pid) => {
      const p = state.weekData.players[pid];
      const info = p && p.team && gi[p.team];
      return info && info.state === 'pre';
    });

  const leftList = notStarted(entryLeft);
  const rightList = notStarted(entryRight);
  if (leftList.length === 0 && rightList.length === 0) return null;

  const row = document.createElement('div');
  row.className = 'yet-to-play-row';
  const left = document.createElement('div');
  left.className = 'yet-to-play yet-to-play-left';
  left.textContent = leftList.length ? `yet to play (${leftList.length}): ${summarizePositions(leftList)}` : '';
  const right = document.createElement('div');
  right.className = 'yet-to-play yet-to-play-right';
  right.textContent = rightList.length ? `yet to play (${rightList.length}): ${summarizePositions(rightList)}` : '';
  row.appendChild(left);
  row.appendChild(right);
  return row;
}

function buildSection(label, rows) {
  const section = document.createElement('div');
  section.className = 'lineup-section';
  const heading = document.createElement('div');
  heading.className = 'section-label';
  heading.textContent = label;
  section.appendChild(heading);
  rows.forEach((r) => section.appendChild(r));
  return section;
}

function openMatchupModal(matchupId) {
  const wd = state.weekData;
  const entries = wd.groups.get(matchupId);
  if (!entries || entries.length < 2) return;
  const mr = wd.medianResult;
  const isMedianMatchup = mr && matchupId === mr.medianMatchupId;
  const medianRosterId = state.medianRoster ? state.medianRoster.roster_id : null;

  let [a, b] = entries;
  if (isMedianMatchup && a.roster_id === medianRosterId) {
    [a, b] = [b, a]; // always put the real (bye-week) team on the left, median on the right
  }

  // For the median matchup, the "right" side's real lineup is whichever team
  // median is currently tracking - median's own roster is an empty shell.
  const rightLineupEntry = isMedianMatchup ? trackedTeamAsMedianEntry(mr.trackedRosterId) || b : b;

  const body = el('modalBody');
  body.innerHTML = '';

  const title = document.createElement('div');
  title.className = 'modal-title';
  title.textContent = `Week ${wd.week}`;
  body.appendChild(title);

  const leftDesc = sideDescriptor(a, false, mr, true);
  const rightDesc = sideDescriptor(b, isMedianMatchup, mr, false);
  const fullyFinal = isMatchupFullyFinal(a, rightLineupEntry);
  body.appendChild(buildMatchupHeader(leftDesc, rightDesc, isMedianMatchup, fullyFinal));

  if (isMedianMatchup) {
    const note = document.createElement('div');
    note.className = 'modal-note';
    note.textContent = `Median mirrors the 5th-highest scoring team (by live projection) among the other 10 teams this week. Right now that's ${rosterName(
      mr.trackedRosterId
    )} - shown below as median's lineup.`;
    body.appendChild(note);
  }

  const ytp = yetToPlayRow(a, rightLineupEntry);
  if (ytp) body.appendChild(ytp);

  const slots = startSlotLabels();
  const starterRows = a.starters.map((pid, i) =>
    buildPlayerRow(pid, rightLineupEntry.starters[i], slots[i] || 'FLEX', a, rightLineupEntry)
  );
  body.appendChild(buildSection('Starters', starterRows));

  const leftBench = (a.players || []).filter((p) => !a.starters.includes(p));
  const rightBench = (rightLineupEntry.players || []).filter((p) => !rightLineupEntry.starters.includes(p));
  const benchLen = Math.max(leftBench.length, rightBench.length);
  if (benchLen > 0) {
    const benchRows = [];
    for (let i = 0; i < benchLen; i++) {
      benchRows.push(buildPlayerRow(leftBench[i] || null, rightBench[i] || null, 'BN', a, rightLineupEntry));
    }
    const benchSection = buildSection('Bench', benchRows);
    benchSection.classList.add('lineup-section-bench');
    body.appendChild(benchSection);
  }

  el('matchupModal').classList.remove('hidden');
}

function closeModal() {
  el('matchupModal').classList.add('hidden');
}

// ------------------------------------------------------------- standings

async function computeStandingsThroughWeek(lastWeek) {
  const rows = {}; // roster_id -> { wins, losses, ties, pf, pa }
  for (const r of state.realRosters) {
    rows[r.roster_id] = { wins: 0, losses: 0, ties: 0, pf: 0, pa: 0 };
  }
  const medianRow = { wins: 0, losses: 0, ties: 0, pf: 0, pa: 0 };
  const medianRosterId = state.medianRoster ? state.medianRoster.roster_id : null;

  for (let w = 1; w <= lastWeek; w++) {
    let matchupEntries;
    try {
      matchupEntries = await getMatchups(state.leagueId, w, { isFinal: true });
    } catch (e) {
      continue;
    }
    if (!matchupEntries || matchupEntries.length === 0) continue;

    const result = computeMedianForWeekFinal({ matchupEntries, medianRosterId });
    for (const [mid, entries] of result.groups) {
      if (entries.length < 2) continue;
      if (mid === result.medianMatchupId) {
        const byeEntry = entries.find((e) => e.roster_id !== medianRosterId);
        if (!byeEntry) continue;
        const byeScore = byeEntry.points;
        const medScore = result.medianScore;
        const row = rows[byeEntry.roster_id];
        if (!row) continue;
        row.pf += byeScore;
        row.pa += medScore;
        medianRow.pf += medScore;
        medianRow.pa += byeScore;
        if (byeScore > medScore) {
          row.wins++;
          medianRow.losses++;
        } else if (byeScore < medScore) {
          row.losses++;
          medianRow.wins++;
        } else {
          row.ties++;
          medianRow.ties++;
        }
      } else {
        const [x, y] = entries;
        const rx = rows[x.roster_id];
        const ry = rows[y.roster_id];
        if (!rx || !ry) continue;
        rx.pf += x.points;
        rx.pa += y.points;
        ry.pf += y.points;
        ry.pa += x.points;
        if (x.points > y.points) {
          rx.wins++;
          ry.losses++;
        } else if (x.points < y.points) {
          ry.wins++;
          rx.losses++;
        } else {
          rx.ties++;
          ry.ties++;
        }
      }
    }
  }

  const sorted = state.realRosters
    .map((r) => ({ roster_id: r.roster_id, ...rows[r.roster_id] }))
    .sort((p, q) => {
      const pPct = winPct(p);
      const qPct = winPct(q);
      if (qPct !== pPct) return qPct - pPct;
      return q.pf - p.pf;
    });

  return { rows: sorted, medianRow };
}

// Records + seeds, used both by the Standings tab and by the small
// "@handle · 7-6 (#5)" line under each team in the scoreboard/matchup header.
async function ensureRecords() {
  const lastWeek = Math.min(state.currentStateWeek - 1, state.playoffWeekStart - 1);
  if (state.standingsCache && state.standingsCache.throughWeek === lastWeek) {
    return state.standingsCache;
  }
  if (lastWeek < 1) {
    state.recordsByRoster = {};
    return null;
  }
  const { rows, medianRow } = await computeStandingsThroughWeek(lastWeek);
  const byRoster = {};
  rows.forEach((r, i) => {
    byRoster[r.roster_id] = { ...r, seed: i + 1 };
  });
  if (state.medianRoster) {
    byRoster[state.medianRoster.roster_id] = { ...medianRow, seed: null };
  }
  state.recordsByRoster = byRoster;
  const cache = { throughWeek: lastWeek, rows, medianRow };
  state.standingsCache = cache;
  return cache;
}

function winPct(r) {
  const total = r.wins + r.losses + r.ties;
  if (total === 0) return 0;
  return (r.wins + r.ties * 0.5) / total;
}

function recordStr(r) {
  return r.ties > 0 ? `${r.wins}-${r.losses}-${r.ties}` : `${r.wins}-${r.losses}`;
}

async function renderStandings() {
  const wrap = el('standingsTableWrap');
  wrap.innerHTML = '<div class="loading">Loading standings…</div>';

  const cache = await ensureRecords();
  if (!cache) {
    wrap.innerHTML = '<div class="loading">Standings will appear once Week 1 is complete.</div>';
    return;
  }
  const { rows, medianRow, throughWeek: lastWeek } = cache;

  wrap.innerHTML = '';

  const note = document.createElement('div');
  note.className = 'standings-note';
  note.textContent = `Through Week ${lastWeek}`;
  wrap.appendChild(note);

  const table = document.createElement('table');
  table.className = 'standings-table';
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>Seed</th><th>Team</th><th>Record</th><th>PF</th><th>PA</th></tr>';
  table.appendChild(thead);
  const tbody = document.createElement('tbody');

  rows.forEach((r, i) => {
    const rank = i + 1;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${rank}</td>
      <td>${rosterName(r.roster_id)}</td>
      <td>${recordStr(r)}</td>
      <td>${fmtPts(r.pf)}</td>
      <td>${fmtPts(r.pa)}</td>
    `;
    tbody.appendChild(tr);

    if (rank === 3) {
      tbody.appendChild(cutLineRow('Boogie Bowl cut line — seeds 1–3 get a Round 1 bye'));
    }
    if (rank === 5) {
      tbody.appendChild(cutLineRow('Playoff cut line — seeds 6+ miss the playoffs'));
    }
  });

  table.appendChild(tbody);
  const scroll = document.createElement('div');
  scroll.className = 'standings-scroll';
  scroll.appendChild(table);
  wrap.appendChild(scroll);

  const medianWrap = document.createElement('div');
  medianWrap.className = 'median-standings';
  const medianTable = document.createElement('table');
  medianTable.className = 'standings-table standings-table-median';
  medianTable.innerHTML = `
    <thead><tr><th colspan="5">Median (placeholder team — not seeded)</th></tr></thead>
    <tbody>
      <tr>
        <td>—</td>
        <td>Median</td>
        <td>${recordStr(medianRow)}</td>
        <td>${fmtPts(medianRow.pf)}</td>
        <td>${fmtPts(medianRow.pa)}</td>
      </tr>
    </tbody>
  `;
  const medianScroll = document.createElement('div');
  medianScroll.className = 'standings-scroll';
  medianScroll.appendChild(medianTable);
  medianWrap.appendChild(medianScroll);
  wrap.appendChild(medianWrap);
}

function cutLineRow(label) {
  const tr = document.createElement('tr');
  tr.className = 'cut-line-row';
  const td = document.createElement('td');
  td.colSpan = 5;
  td.innerHTML = `<div class="cut-line"><span>${label}</span></div>`;
  tr.appendChild(td);
  return tr;
}

// -------------------------------------------------------------- controls

function switchTab(tab) {
  state.activeTab = tab;
  el('scoreboardView').classList.toggle('hidden', tab !== 'scoreboard');
  el('standingsView').classList.toggle('hidden', tab !== 'standings');
  el('tabScoreboard').classList.toggle('active', tab === 'scoreboard');
  el('tabStandings').classList.toggle('active', tab === 'standings');
  if (tab === 'standings') renderStandings();
}

async function refreshCurrentWeek() {
  try {
    await loadWeekData(state.selectedWeek);
    renderScoreboard();
    el('lastUpdated').textContent = `Updated ${new Date().toLocaleTimeString()}`;
  } catch (e) {
    console.error(e);
    el('lastUpdated').textContent = 'Update failed — retrying…';
  }
}

function startPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = setInterval(() => {
    if (state.activeTab === 'scoreboard') refreshCurrentWeek();
  }, LIVE_POLL_MS);
}

async function init() {
  el('tabScoreboard').addEventListener('click', () => switchTab('scoreboard'));
  el('tabStandings').addEventListener('click', () => switchTab('standings'));
  el('modalClose').addEventListener('click', closeModal);
  el('matchupModal').addEventListener('click', (e) => {
    if (e.target.id === 'matchupModal') closeModal();
  });
  el('weekSelect').addEventListener('change', async (e) => {
    state.selectedWeek = parseInt(e.target.value, 10);
    el('scoreboardGrid').innerHTML = '<div class="loading">Loading…</div>';
    await refreshCurrentWeek();
  });
  el('settingsBtn').addEventListener('click', () => {
    el('leagueIdInput').value = state.leagueId || '';
    el('settingsModal').classList.remove('hidden');
  });
  el('cancelSettings').addEventListener('click', () => el('settingsModal').classList.add('hidden'));
  el('saveSettings').addEventListener('click', () => {
    const val = el('leagueIdInput').value.trim();
    if (val) {
      setLeagueId(val);
      el('settingsModal').classList.add('hidden');
      boot();
    }
  });

  await boot();
}

async function boot() {
  el('scoreboardGrid').innerHTML = '<div class="loading">Loading league…</div>';
  try {
    await loadLeagueMeta();
    await ensureRecords();
    await refreshCurrentWeek();
    startPolling();
  } catch (e) {
    console.error(e);
    el('scoreboardGrid').innerHTML = `<div class="loading error">Couldn't load league data: ${e.message}</div>`;
  }
}

document.addEventListener('DOMContentLoaded', init);
