/**
 * 第十三轮：系统设置页各模块「回弹收缩」
 *
 * 覆盖用户反馈的「页面太脏、不好识别」这个问题：
 *  - 每个小模块都包进了可折叠卡片（不再是长长的表单墙）
 *  - 默认只展开「公司信息」，其余收成一行标题
 *  - 点标题能来回切换；页头有「全部展开 / 全部收起」
 *  - 展开状态写进 localStorage，下次进来还是原来的样子
 *  - **收起不等于销毁**：DOM 保留，表单里填了一半的内容不会丢
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import 'fake-indexeddb/auto'
import SettingsView from '../src/views/boss/SettingsView.vue'
import CollapseCard from '../src/components/ui/CollapseCard.vue'
import router from '../src/router'

const STORAGE_KEY = 'erp_settings_panels'

// 页面上的十个模块（顺序与 SettingsView 模板一致）
// 第十六轮新增「应用图标与桌面快捷方式」，插在「品牌与图标」之后；
// 第十九轮新增「操作日志」，插在「库房管理」与「云同步」之间（从侧边栏独立菜单归纳进来）
const TITLES = [
  '公司信息', '品牌与图标', '应用图标与桌面快捷方式', '数据备份与恢复', '示例数据',
  '价格规则（加价比例）', '打印设置', '库房管理', '📜 操作日志', '☁️ 云同步（GitHub）'
]

async function mountSettings() {
  const w = mount(SettingsView, { global: { plugins: [router] } })
  await flushPromises()
  return w
}

/** 取每个模块的标题与展开状态 */
function states(w: ReturnType<typeof mount>) {
  return w.findAll('.cc-head').map(h => ({
    title: h.find('.cc-title').text(),
    open: h.attributes('aria-expanded') === 'true'
  }))
}

beforeEach(async () => {
  setActivePinia(createPinia())
  localStorage.removeItem(STORAGE_KEY)
  await router.push('/login')
  await router.isReady()
})

describe('CollapseCard 组件本身', () => {
  it('点标题来回派发展开 / 收起事件（受控组件，由父级回写）', async () => {
    const w = mount(CollapseCard, {
      props: { title: '测试模块', modelValue: true },
      slots: { default: '<p class="body-mark">内容</p>' }
    })
    expect(w.find('.cc-head').attributes('aria-expanded')).toBe('true')

    await w.find('.cc-head').trigger('click')
    expect(w.emitted('update:modelValue')?.[0]).toEqual([false])
    // 父级回写后才会真正收起
    await w.setProps({ modelValue: false })
    expect(w.find('.cc-head').attributes('aria-expanded')).toBe('false')
    expect(w.find('.cc-body').classes()).toContain('collapsed')

    await w.find('.cc-head').trigger('click')
    expect(w.emitted('update:modelValue')?.[1]).toEqual([true])
    await w.setProps({ modelValue: true })
    expect(w.find('.cc-head').attributes('aria-expanded')).toBe('true')
  })

  it('键盘 Enter / 空格也能切换（无障碍）', async () => {
    const w = mount(CollapseCard, {
      props: { title: '测试模块', modelValue: false },
      slots: { default: '<p class="body-mark">内容</p>' }
    })
    await w.find('.cc-head').trigger('keyup', { key: 'Enter' })
    expect(w.find('.cc-head').attributes('aria-expanded')).toBe('false') // props 未变，靠 emit 给父组件
    expect(w.emitted('update:modelValue')?.length).toBe(1)
    expect(w.emitted('update:modelValue')?.[0]).toEqual([true])
  })

  it('收起时内容仍在 DOM 里（只是 CSS 折叠），表单不会丢', async () => {
    const w = mount(CollapseCard, {
      props: { title: '测试模块', modelValue: false },
      slots: { default: '<p class="body-mark">内容</p>' }
    })
    expect(w.find('.body-mark').exists()).toBe(true)
    expect(w.find('.cc-body').classes()).toContain('collapsed')
    await w.setProps({ modelValue: true })
    expect(w.find('.cc-body').classes()).not.toContain('collapsed')
  })

  it('标题旁的箭头会随状态旋转', async () => {
    const w = mount(CollapseCard, { props: { title: 'T', modelValue: true } })
    expect(w.find('.cc-arrow').classes()).not.toContain('collapsed')
    await w.setProps({ modelValue: false })
    expect(w.find('.cc-arrow').classes()).toContain('collapsed')
  })
})

describe('系统设置页：模块可折叠', () => {
  it('十个模块都包成了折叠卡片', async () => {
    const w = await mountSettings()
    expect(states(w).map(s => s.title)).toEqual(TITLES)
  })

  it('默认只展开「公司信息」，其余收起', async () => {
    const w = await mountSettings()
    const s = states(w)
    expect(s.filter(x => x.open).map(x => x.title)).toEqual(['公司信息'])
    expect(s.length - 1).toBe(s.filter(x => !x.open).length)
  })

  it('点标题能单独展开该模块', async () => {
    const w = await mountSettings()
    const heads = w.findAll('.cc-head')
    const printIdx = heads.findIndex(h => h.find('.cc-title').text() === '打印设置')
    expect(printIdx).toBeGreaterThan(0)

    await heads[printIdx].trigger('click')
    await flushPromises()
    expect(states(w)[printIdx].open).toBe(true)
    // 其它模块不受影响
    expect(states(w).filter(x => x.open).map(x => x.title)).toEqual(['公司信息', '打印设置'])
  })

  it('「全部展开」后每个模块都打开，「全部收起」后全部关上', async () => {
    const w = await mountSettings()
    const btns = w.findAll('.collapse-bar button')
    expect(btns.length).toBe(2)

    await btns[0].trigger('click')
    await flushPromises()
    expect(states(w).every(s => s.open)).toBe(true)

    await btns[1].trigger('click')
    await flushPromises()
    expect(states(w).some(s => s.open)).toBe(false)
  })

  it('展开状态写进 localStorage，重新进入后保持', async () => {
    const w1 = await mountSettings()
    await w1.findAll('.collapse-bar button')[0].trigger('click')
    await flushPromises()

    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    expect(saved.price).toBe(true)
    expect(saved.print).toBe(true)

    // 重新挂载，模拟「下次再进设置页」
    const w2 = await mountSettings()
    expect(states(w2).every(s => s.open)).toBe(true)
  })

  it('localStorage 里是坏数据也不会崩，回落到默认', async () => {
    localStorage.setItem(STORAGE_KEY, '{不是 JSON')
    const w = await mountSettings()
    expect(states(w).filter(x => x.open).map(x => x.title)).toEqual(['公司信息'])
  })

  it('收起后模块内容仍在 DOM（不影响已有用例与未保存的填写）', async () => {
    const w = await mountSettings()
    await w.findAll('.collapse-bar button')[1].trigger('click')
    await flushPromises()

    // 公司信息的输入框虽然随整个页面收起了，但节点还在
    expect(w.find('input[placeholder="公司名称"]').exists()).toBe(true)
    expect(w.find('.cc-body.collapsed').exists()).toBe(true)
  })

  it('「退出登录」保持为独立区块，不做折叠', async () => {
    const w = await mountSettings()
    const logout = w.findAll('button').find(b => b.text() === '退出登录')
    expect(logout?.exists()).toBe(true)
    expect(w.find('.cc-head .cc-title').exists()).toBe(true)
    expect(TITLES).not.toContain('退出登录')
  })
})
