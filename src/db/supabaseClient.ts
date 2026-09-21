import { createClient } from '@supabase/supabase-js'

/**
 * Supabase 云数据库客户端（V1.1 第二阶段引入）
 *
 * 项目：bailihongxi's Project
 * URL：https://athxdnxyqwgkolxggras.supabase.co
 *
 * 注意：URL 里是 ksprzfqq（双 q），不是单 q。
 * anon/publishable key 设计为前端公开使用，第一版暂未开 RLS，
 * 应用层自有登录保护；后续接入 Supabase Auth 后改 RLS 行级权限。
 */
export const SUPABASE_URL = 'https://athxdnxyqwgkolxggras.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_jHWjftj73zm80eZKLxZOCg_SgdZ8aCu'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

/** 当前是否启用云端数据源（false = 仍用本地 IndexedDB，即 V1.0-12 保底模式） */
// 测试环境（vitest）强制 false，单元测试仍用本地 Dexie；浏览器运行时由这里控制
const isTest = import.meta.env.MODE === 'test'
export const USE_CLOUD = true && !isTest
