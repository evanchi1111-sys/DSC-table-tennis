// 積分排名與同分判定。
// 1. 勝場數多者在前。
// 2. 兩隊同勝場：看兩隊直接對戰的勝負；尚未對戰則比全賽局數比。
// 3. 三隊以上同勝場（互咬）：先比這幾隊彼此對戰的局數比，再比全賽局數比。
// 4. 仍完全相同：依主辦單位登錄的抽籤順位。

const ratio = (won, lost) => (lost === 0 ? (won > 0 ? Infinity : 1) : won / lost);
const drawRank = (stat) => stat.team.draw_rank ?? 999;

export function computeRankings(teams, matches, division) {
  const divisionTeams = teams.filter((t) => t.division === division);
  const completed = matches.filter((m) => m.division === division && m.status === 'completed');

  const stats = new Map(
    divisionTeams.map((team) => [
      team.id,
      { team, wins: 0, losses: 0, played: 0, gamesWon: 0, gamesLost: 0, gamesRatio: 1, mutualRatio: null, rank: 0, basis: '', drawTied: false },
    ])
  );

  for (const m of completed) {
    const a = stats.get(m.team1_id);
    const b = stats.get(m.team2_id);
    if (!a || !b) continue;
    a.played++;
    b.played++;
    if (m.winner_id === m.team1_id) { a.wins++; b.losses++; }
    else if (m.winner_id === m.team2_id) { b.wins++; a.losses++; }
    for (const g of m.games || []) {
      if (g === 1) { a.gamesWon++; b.gamesLost++; }
      else if (g === 2) { b.gamesWon++; a.gamesLost++; }
    }
  }
  for (const s of stats.values()) s.gamesRatio = ratio(s.gamesWon, s.gamesLost);

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
  if (a.gamesRatio !== b.gamesRatio) {
    a.basis = b.basis = '全賽局數比';
    return a.gamesRatio > b.gamesRatio ? [a, b] : [b, a];
  }
  a.drawTied = b.drawTied = true;
  a.basis = b.basis = '戰績相同・抽籤';
  return drawRank(a) <= drawRank(b) ? [a, b] : [b, a];
}

function resolveGroup(group, completed) {
  const ids = new Set(group.map((s) => s.team.id));
  const mutual = completed.filter((m) => ids.has(m.team1_id) && ids.has(m.team2_id));

  for (const s of group) {
    let won = 0;
    let lost = 0;
    for (const m of mutual) {
      const side = m.team1_id === s.team.id ? 1 : m.team2_id === s.team.id ? 2 : 0;
      if (!side) continue;
      for (const g of m.games || []) {
        if (g === side) won++;
        else if (g === 1 || g === 2) lost++;
      }
    }
    s.mutualRatio = ratio(won, lost);
  }

  const sorted = [...group].sort((a, b) => {
    if (a.mutualRatio !== b.mutualRatio) return a.mutualRatio > b.mutualRatio ? -1 : 1;
    if (a.gamesRatio !== b.gamesRatio) return a.gamesRatio > b.gamesRatio ? -1 : 1;
    if (drawRank(a) !== drawRank(b)) return drawRank(a) - drawRank(b);
    return 0;
  });

  // 每隊標示是在哪一關被分出名次
  for (const s of sorted) {
    const sameMutual = group.filter((o) => o.mutualRatio === s.mutualRatio);
    if (sameMutual.length === 1) {
      s.basis = '同分互咬・局數比';
    } else if (sameMutual.filter((o) => o.gamesRatio === s.gamesRatio).length === 1) {
      s.basis = '全賽局數比';
    } else {
      s.drawTied = true;
      s.basis = '戰績相同・抽籤';
    }
  }
  return sorted;
}
