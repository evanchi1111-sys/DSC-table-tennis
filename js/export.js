// 匯出 Excel 與列印成績。report 由 app.js 組好：
// { title, formatLabel, generatedAt, divisions: [{ label, rankings, matches }], teamName(id), statusLabel(match) }

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const gamesWon = (m, side) => (m.games || []).filter((g) => g === side).length;
const gameDetail = (m, report) => (m.games || []).map((g, i) => `第${i + 1}局 ${g === 1 ? report.shortName(m.team1_id) : report.shortName(m.team2_id)}`).join('、');
const fileStamp = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

function rankingRows(division) {
  return division.rankings.map((s) => ({
    名次: s.rank,
    隊伍: `${s.team.player_a} & ${s.team.player_b}`,
    出賽: s.played,
    勝: s.wins,
    敗: s.losses,
    局數: `${s.gamesWon} : ${s.gamesLost}`,
    判定依據: s.drawTied && s.team.draw_rank == null ? `${s.basis}（未抽籤）` : s.basis,
  }));
}

function matchRows(division, report) {
  return division.matches.map((m) => ({
    輪次: `第 ${m.round} 輪`,
    隊伍一: report.teamName(m.team1_id),
    隊伍二: report.teamName(m.team2_id),
    局數比分: m.status === 'not_started' ? '' : `${gamesWon(m, 1)} : ${gamesWon(m, 2)}`,
    各局勝方: gameDetail(m, report),
    勝方: m.winner_id ? report.teamName(m.winner_id) : '',
    狀態: report.statusLabel(m),
  }));
}

export function exportExcel(report) {
  const XLSX = window.XLSX;
  if (!XLSX) throw new Error('匯出模組還在載入，請稍候幾秒再試');
  const wb = XLSX.utils.book_new();
  for (const division of report.divisions) {
    const rankSheet = XLSX.utils.json_to_sheet(rankingRows(division));
    rankSheet['!cols'] = [{ wch: 6 }, { wch: 22 }, { wch: 6 }, { wch: 5 }, { wch: 5 }, { wch: 8 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, rankSheet, `${division.label}排名`);

    const matchSheet = XLSX.utils.json_to_sheet(matchRows(division, report));
    matchSheet['!cols'] = [{ wch: 8 }, { wch: 22 }, { wch: 22 }, { wch: 9 }, { wch: 40 }, { wch: 22 }, { wch: 8 }];
    XLSX.utils.book_append_sheet(wb, matchSheet, `${division.label}賽程`);
  }
  XLSX.writeFile(wb, `桌球雙打賽成績_${fileStamp(report.generatedAt)}.xlsx`);
}

function htmlTable(rows) {
  if (!rows.length) return '<p class="print-empty">（無資料）</p>';
  const headers = Object.keys(rows[0]);
  return `<table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr>${headers.map((h) => `<td>${esc(r[h])}</td>`).join('')}</tr>`)
    .join('')}</tbody></table>`;
}

export function printReport(report) {
  const area = document.getElementById('print-area');
  const stamp = report.generatedAt.toLocaleString('zh-TW', { hour12: false });
  area.innerHTML = `
    <h1>${esc(report.title)}</h1>
    <p class="print-meta">賽制：${esc(report.formatLabel)}　｜　列印時間：${esc(stamp)}</p>
    ${report.divisions
      .map(
        (d) => `
      <section class="print-division">
        <h2>${esc(d.label)}・積分排名</h2>
        ${htmlTable(rankingRows(d))}
        <h2>${esc(d.label)}・賽程與比分</h2>
        ${htmlTable(matchRows(d, report))}
      </section>`
      )
      .join('')}`;
  window.print();
}
