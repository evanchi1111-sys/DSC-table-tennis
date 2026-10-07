// Supabase 專案設定：到 Supabase → Project Settings → API（或 Data API / API Keys）複製。
// 這兩個值本來就是公開的，可以放在網頁裡；真正的安全由資料庫規則（supabase/setup.sql）把關。
// 注意：千萬不要貼上 service_role / secret key。
export const SUPABASE_URL = '';       // 例如 'https://abcdefghijkl.supabase.co'
export const SUPABASE_ANON_KEY = '';  // anon public key，或 sb_publishable_ 開頭的 key

// 主辦單位共用帳號，必須與 supabase/setup.sql 第 4 段的 email 相同
export const ORGANIZER_EMAIL = 'organizer@dsc-table-tennis.app';
