/**
 * 应用版本基线
 *
 * 版本号统一在这里维护，发版时只改这一处：
 *  - 系统设置页头徽标读取 APP_VERSION
 *  - package.json 的 version 与之对应（semver 形式）
 *  - PRD / 开发计划文档的版本行同步更新
 *
 * 版本命名：V<主版本>.<次版本>-<修订号>，例如 V1.0-1 表示 1.0 的第 1 个修订版。
 */
export const APP_VERSION = 'V2.1-2.2'

/** 版本发布基线日期 */
export const APP_RELEASE_DATE = '2026-09-24'

export const APP_NAME = '家电批发进销存 ERP'
