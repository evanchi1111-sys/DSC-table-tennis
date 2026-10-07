// 單循環賽程：環狀輪轉法（circle method），隊數為單數時自動加入輪空。
export function generateRoundRobin(teams, division, matchFormat) {
  if (teams.length < 2) return [];

  const slots = [...teams];
  if (slots.length % 2 !== 0) slots.push(null); // null = 輪空

  const n = slots.length;
  const rows = [];
  for (let round = 1; round < n; round++) {
    let seq = 0;
    for (let i = 0; i < n / 2; i++) {
      const home = slots[i];
      const away = slots[n - 1 - i];
      if (home && away) {
        rows.push({
          division,
          round,
          seq: seq++,
          team1_id: home.id,
          team2_id: away.id,
          match_format: matchFormat,
        });
      }
    }
    // 第一個位置固定，其餘順時針轉一格
    slots.splice(1, 0, slots.pop());
  }
  return rows;
}
