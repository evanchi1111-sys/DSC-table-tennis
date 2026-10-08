// 積分排名與同分判定。
// 每局比分存成 [隊伍一得分, 隊伍二得分]，例如 [11, 8]。
//
// 1. 勝場數多者在前。
// 2. 兩隊同勝場：看兩隊直接對戰的勝負；尚未對戰則依序比全賽局數勝率、分數勝率，再抽籤。
// 3. 三隊以上同勝場（互咬）：只計算這幾隊彼此之間的對戰，依序比
//    第一步 場數勝率（勝場 ÷ 敗場）→ 第二步 局數勝率（勝局 ÷ 敗局）
//    → 第三步 分數勝率（得分 ÷ 失分）→ 第四步 抽籤；過程中剩兩隊同分時，改看兩隊對戰勝負。

const ratio = (won, lost) => (lost === 0 ? (won > 0 ? Infinity : 1) : won / lost);
const drawRank = (stat) => stat.team.draw_rank ?? 999;

export const gameWinner = (g) => (Array.isArray(g) && g[0] !== g[1] ? (g[0] > g[1] ? 1 : 2) : 0);
export const gamesWon = (games, side) => (games || []).filter((g) => gameWinner(g) === side).length;

// 從某一隊的角度累計一場比賽的場、局、分
function tally(totals, match, side) {
  const other = side === 1 ? 2 : 1;
  const myTeam = side === 1 ? match.team1_id : match.team2_id;
  if (match.winner_id === myTeam) totals.matchesWon++;
  else if (match.winner_id) totals.matchesLost++;
  for (const g of match.games || []) {
    const w = gameWinner(g);
    if (w === side) totals.gamesWon++;
    else if (w === other) totals.gamesLost++;
    if (Array.isArray(g)) {
      totals.pointsWon += Number(g[side - 1]) || 0;
      totals.pointsLost += Number(g[other - 1]) || 0;
    }
  }
}

const emptyTotals = () => ({ matchesWon: 0, matchesLost: 0, gamesWon: 0, gamesLost: 0, pointsWon: 0, pointsLost: 0 });

export function computeRankings(teams, matches, division) {
  const divisionTeams = teams.filter((t) => t.division === division);
  const completed = matches.filter((m) => m.division === division && m.status === 'completed');

  const stats = new Map(
    divisionTeams.map((team) => [team.id, { team, ...emptyTotals(), wins: 0, losses: 0, played: 0, rank: 0, basis: '', drawTied: false }])
  );

  for (const m of completed) {
    const a = stats.get(m.team1_id);
    const b = stats.get(m.team2_id);
    if (!a || !b) continue;
    a.played++;
    b.played++;
    tally(a, m, 1);
    tally(b, m, 2);
  }
  for (const s of stats.values()) {
    s.wins = s.matchesWon;
    s.losses = s.matchesLost;
    s.gamesRatio = ratio(s.gamesWon, s.gamesLost);
    s.pointsRatio = ratio(s.pointsWon, s.pointsLost);
  }

  const all = [...stats.values()];
  if (completed.length === 0) {
    all.forEach((s, i) => { s.rank = i + 1; s.basis = '尚未有比賽結果'; });
    return all;
  }

  const byWins = new Map();
  for (const s of all) {
    if (!byWins.has(s.wins)) byWins.set(s.wins, []);
    byWins.get(s.wins).push(s);
  }

  const ordered = [];
  for (const wins of [...byWins.keys()].sort((x, y) => y - x)) {
    const group = byWins.get(wins);
    if (group.length === 1) {
      group[0].basis = '勝場數';
      ordered.push(group[0]);
    } else if (group.length === 2) {
      ordered.push(...resolvePair(group, completed));
    } else {
      ordered.push(...resolveGroup(group, completed));
    }
  }
  ordered.forEach((s, i) => { s.rank = i + 1; });
  return ordered;
}

function resolvePair([a, b], completed) {
  const h2h = completed.find(
    (m) => (m.team1_id === a.team.id && m.team2_id === b.team.id) || (m.team1_id === b.team.id && m.team2_id === a.team.id)
  );
  if (h2h && (h2h.winner_id === a.team.id || h2h.winner_id === b.team.id)) {
    a.basis = b.basis = '兩隊對戰勝負';
    return h2h.winner_id === a.team.id ? [a, b] : [b, a];
  }
  // 兩隊還沒交手（比賽進行中才會發生）：比全賽數據
  if (a.gamesRatio !== b.gamesRatio) {
    a.basis = b.basis = '全賽局數勝率';
    return a.gamesRatio > b.gamesRatio ? [a, b] : [b, a];
  }
  if (a.pointsRatio !== b.pointsRatio) {
    a.basis = b.basis = '全賽分數勝率';
    return a.pointsRatio > b.pointsRatio ? [a, b] : [b, a];
  }
  a.drawTied = b.drawTied = true;
  a.basis = b.basis = '戰績相同・抽籤';
  return drawRank(a) <= drawRank(b) ? [a, b] : [b, a];
}

const STEPS = [
  { key: 'mutualMatchRatio', label: '互咬・場數勝率' },
  { key: 'mutualGameRatio', label: '互咬・局數勝率' },
  { key: 'mutualPointRatio', label: '互咬・分數勝率' },
];

function resolveGroup(group, completed) {
  const ids = new Set(group.map((s) => s.team.id));
  const mutual = completed.filter((m) => ids.has(m.team1_id) && ids.has(m.team2_id));

  for (const s of group) {
    const t = emptyTotals();
    for (const m of mutual) {
      if (m.team1_id === s.team.id) tally(t, m, 1);
      else if (m.team2_id === s.team.id) tally(t, m, 2);
    }
    s.mutual = t;
    s.mutualMatchRatio = ratio(t.matchesWon, t.matchesLost);
    s.mutualGameRatio = ratio(t.gamesWon, t.gamesLost);
    s.mutualPointRatio = ratio(t.pointsWon, t.pointsLost);
  }

  return splitByStep(group, 0, completed);
}

// 依第 step 步把仍同分的隊伍分組，數值高的在前，每組再往下一步比。
// 某一步比完剛好剩兩隊同分時，改看這兩隊的對戰勝負（兩隊還沒交手才繼續比下一步）。
function splitByStep(members, step, completed) {
  if (members.length === 1) return members;
  if (members.length === 2 && step > 0) {
    const [a, b] = members;
    const h2h = completed.find(
      (m) => (m.team1_id === a.team.id && m.team2_id === b.team.id) || (m.team1_id === b.team.id && m.team2_id === a.team.id)
    );
    if (h2h && (h2h.winner_id === a.team.id || h2h.winner_id === b.team.id)) {
      a.basis = b.basis = '互咬・剩兩隊看對戰勝負';
      return h2h.winner_id === a.team.id ? [a, b] : [b, a];
    }
  }
  if (step >= STEPS.length) {
    members.forEach((s) => { s.drawTied = true; s.basis = '戰績相同・抽籤'; });
    return [...members].sort((a, b) => drawRank(a) - drawRank(b));
  }
  const { key, label } = STEPS[step];
  const values = [...new Set(members.map((s) => s[key]))].sort((x, y) => y - x);
  const result = [];
  for (const v of values) {
    const part = members.filter((s) => s[key] === v);
    if (part.length === 1) part[0].basis = label;
    result.push(...splitByStep(part, step + 1, completed));
  }
  return result;
}
