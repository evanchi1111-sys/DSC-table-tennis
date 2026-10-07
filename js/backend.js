import { SUPABASE_URL, SUPABASE_ANON_KEY, ORGANIZER_EMAIL } from './config.js';

const DEFAULT_SETTINGS = { id: 1, status: 'setup', match_format: 'best_of_3' };

export function isConfigured() {
  return /^https:\/\/.+/.test(SUPABASE_URL) && SUPABASE_ANON_KEY.length > 20;
}

export async function createBackend({ demo }) {
  return demo ? createDemoBackend() : createSupabaseBackend();
}

function friendlyError(error) {
  const msg = String(error?.message || error || '');
  if (/invalid login credentials/i.test(msg)) return new Error('帳號或密碼錯誤');
  if (/row-level security|permission denied|42501/i.test(msg) || error?.code === '42501') {
    return new Error('沒有寫入權限，請重新登入主辦帳號');
  }
  if (/password should be at least|weak password/i.test(msg)) return new Error('密碼至少需要 6 個字元');
  if (/same.*password|different from the old/i.test(msg)) return new Error('新密碼不能和舊密碼相同');
  if (/failed to fetch|network/i.test(msg)) return new Error('網路連線失敗，請檢查網路後再試');
  if (/rate limit|too many/i.test(msg)) return new Error('嘗試次數過多，請稍後再試');
  return new Error(msg || '發生未知錯誤');
}

// ---------------------------------------------------------------- Supabase

async function createSupabaseBackend() {
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const check = ({ data, error }) => {
    if (error) throw friendlyError(error);
    return data;
  };
  // 被安全規則擋下的 update/delete 不會報錯，只會影響 0 列，所以要另外檢查
  const mustAffect = (result) => {
    const rows = check(result);
    if (!rows || rows.length === 0) throw new Error('沒有寫入權限，請重新登入主辦帳號');
    return rows;
  };
  const updateSettings = async (patch) =>
    mustAffect(await sb.from('settings').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', 1).select());

  return {
    async load() {
      const [settings, teams, matches] = await Promise.all([
        sb.from('settings').select('*').eq('id', 1).maybeSingle(),
        sb.from('teams').select('*').order('created_at').order('id'),
        sb.from('matches').select('*').order('round').order('seq'),
      ]);
      return {
        settings: check(settings) || { ...DEFAULT_SETTINGS },
        teams: check(teams),
        matches: check(matches),
      };
    },
    // onStatus 會在每次連上（包含斷線後自動重連）時收到 'SUBSCRIBED'，
    // 斷線時收到 'CHANNEL_ERROR' / 'TIMED_OUT' / 'CLOSED'
    subscribe(onChange, onStatus = () => {}) {
      const channel = sb.channel('tournament');
      for (const table of ['settings', 'teams', 'matches']) {
        channel.on('postgres_changes', { event: '*', schema: 'public', table }, onChange);
      }
      channel.subscribe((status) => onStatus(status));
      return () => sb.removeChannel(channel);
    },

    async getUser() {
      const { data } = await sb.auth.getSession();
      return data.session?.user ?? null;
    },
    onAuthChange(callback) {
      const { data } = sb.auth.onAuthStateChange((_event, session) => callback(session?.user ?? null));
      return () => data.subscription.unsubscribe();
    },
    async signIn(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw friendlyError(error);
    },
    async signOut() {
      await sb.auth.signOut();
    },
    async changePassword(email, currentPassword, newPassword) {
      const verify = await sb.auth.signInWithPassword({ email, password: currentPassword });
      if (verify.error) throw new Error('目前密碼錯誤');
      const { error } = await sb.auth.updateUser({ password: newPassword });
      if (error) throw friendlyError(error);
    },

    async addTeams(rows) {
      check(await sb.from('teams').insert(rows));
    },
    async updateTeam(id, patch) {
      mustAffect(await sb.from('teams').update(patch).eq('id', id).select());
    },
    async deleteTeam(id) {
      mustAffect(await sb.from('teams').delete().eq('id', id).select());
    },
    async setMatchFormat(matchFormat) {
      await updateSettings({ match_format: matchFormat });
    },
    async startTournament(matchRows, matchFormat) {
      if (matchRows.length) check(await sb.from('matches').insert(matchRows));
      await updateSettings({ status: 'active', match_format: matchFormat });
    },
    async saveMatch(id, patch) {
      mustAffect(await sb.from('matches').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select());
    },
    async resetTournament() {
      await updateSettings({ status: 'setup' });
      check(await sb.from('matches').delete().not('id', 'is', null));
      check(await sb.from('teams').update({ draw_rank: null }).not('id', 'is', null));
    },
    async wipeAll() {
      await updateSettings({ status: 'setup' });
      check(await sb.from('matches').delete().not('id', 'is', null));
      check(await sb.from('teams').delete().not('id', 'is', null));
    },
  };
}

// ---------------------------------------------------------------- 示範模式
// 資料只存在這個分頁的記憶體裡，重新整理就會回到範例資料，方便試用與測試。

function createDemoBackend() {
  const DEMO_PASSWORD = 'demo1234';
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
  const now = Date.now();
  const sample = [
    ['王小明', '李大華', 'competitive'], ['陳志強', '林建宏', 'competitive'], ['張美玲', '黃淑芬', 'competitive'],
    ['劉家豪', '吳俊傑', 'competitive'], ['蔡宜君', '鄭雅婷', 'competitive'],
    ['許文彬', '楊佩珊', 'fun'], ['郭子軒', '謝欣妤', 'fun'], ['洪偉倫', '邱詩涵', 'fun'], ['周品妍', '曾冠宇', 'fun'],
  ];
  const db = {
    settings: { ...DEFAULT_SETTINGS },
    teams: sample.map(([a, b, division], i) => ({
      id: uid(), player_a: a, player_b: b, division, draw_rank: null, created_at: new Date(now + i).toISOString(),
    })),
    matches: [],
  };
  let user = null;
  const dataListeners = new Set();
  const authListeners = new Set();
  const emit = () => setTimeout(() => dataListeners.forEach((fn) => fn()), 50);
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const requireOrganizer = () => {
    if (!user) throw new Error('沒有寫入權限，請重新登入主辦帳號');
  };

  return {
    isDemo: true,
    demoPassword: DEMO_PASSWORD,
    async load() {
      return clone(db);
    },
    subscribe(onChange, onStatus = () => {}) {
      dataListeners.add(onChange);
      setTimeout(() => onStatus('SUBSCRIBED'), 0);
      return () => dataListeners.delete(onChange);
    },
    async getUser() {
      return user;
    },
    onAuthChange(callback) {
      authListeners.add(callback);
      return () => authListeners.delete(callback);
    },
    async signIn(email, password) {
      if (email.toLowerCase() !== ORGANIZER_EMAIL.toLowerCase() || password !== DEMO_PASSWORD) throw new Error('帳號或密碼錯誤');
      user = { email: ORGANIZER_EMAIL };
      authListeners.forEach((fn) => fn(user));
    },
    async signOut() {
      user = null;
      authListeners.forEach((fn) => fn(null));
    },
    async changePassword() {
      throw new Error('示範模式無法變更密碼');
    },
    async addTeams(rows) {
      requireOrganizer();
      rows.forEach((r, i) => db.teams.push({ id: uid(), draw_rank: null, created_at: new Date(Date.now() + i).toISOString(), ...r }));
      emit();
    },
    async updateTeam(id, patch) {
      requireOrganizer();
      Object.assign(db.teams.find((t) => t.id === id), patch);
      emit();
    },
    async deleteTeam(id) {
      requireOrganizer();
      db.teams = db.teams.filter((t) => t.id !== id);
      db.matches = db.matches.filter((m) => m.team1_id !== id && m.team2_id !== id);
      emit();
    },
    async setMatchFormat(matchFormat) {
      requireOrganizer();
      db.settings.match_format = matchFormat;
      emit();
    },
    async startTournament(matchRows, matchFormat) {
      requireOrganizer();
      db.matches = matchRows.map((r) => ({ id: uid(), games: [], winner_id: null, status: 'not_started', ...r }));
      Object.assign(db.settings, { status: 'active', match_format: matchFormat });
      emit();
    },
    async saveMatch(id, patch) {
      requireOrganizer();
      Object.assign(db.matches.find((m) => m.id === id), patch);
      emit();
    },
    async resetTournament() {
      requireOrganizer();
      db.matches = [];
      db.teams.forEach((t) => { t.draw_rank = null; });
      db.settings.status = 'setup';
      emit();
    },
    async wipeAll() {
      requireOrganizer();
      db.matches = [];
      db.teams = [];
      db.settings.status = 'setup';
      emit();
    },
  };
}
