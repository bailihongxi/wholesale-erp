import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, ref, KeepAlive, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import PurchaseCreateView from '../src/views/purchase/PurchaseCreateView.vue'
import { useUserStore } from '../src/stores/user'
import { db } from '../src/db'

/**
 * 回归锁：新建采购单被 keep-alive 缓存后，再次进入必须重置表单。
 *
 * ## 背景（2026-09-28 反馈）
 *
 * `App.vue` 用 `<keep-alive>` 无差别缓存所有路由组件。新建采购单的 `form` 是
 * `<script setup>` 内的 `reactive`，只在首次 `onMounted` 初始化一次。第二次进入时
 * 组件是「复活」而不是「重新挂载」，`onMounted` 不重跑，`form.remark` 等会残留上次
 * 填写的内容 —— 表现为「新建采购单的备注框里出现历史内容」。
 *
 * 修法：在 `onActivated` 里把 `form` 清空。本文件同时验证「真的会重置」与
 * 「源码里确有 onActivated 重置逻辑」（防止被随手改回）。
 */

const testRouter = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: '/', redirect: '/purchase/orders' },
    { path: '/purchase/orders', component: { template: '<div>po</div>' } },
    { path: '/purchase/orders/new', component: { template: '<div>new</div>' } },
    { path: '/:pathMatch(.*)*', component: { template: '<div></div>' } }
  ]
})

function setRole(role: string): void {
  const u = useUserStore()
  u.currentUser = {
    id: 1, name: 'tester', phone: '1', password: '',
    role: role as any, status: 'active', createdAt: ''
  }
}

describe('新建采购单：keep-alive 复用下表单必须重置', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.open()
    await Promise.all(db.tables.map(t => t.clear()))
    setRole('boss')
    await testRouter.push('/purchase/orders/new')
    await testRouter.isReady()
  })

  it('复用缓存后再次进入，备注框被清空（修复 2026-09-28 反馈）', async () => {
    const show = ref(true)
    const Other = defineComponent({ name: 'OtherView', setup: () => () => h('div', 'other') })
    const Host = defineComponent({
      name: 'Host',
      setup: () => () =>
        h(KeepAlive, null, {
          default: () => h(show.value ? PurchaseCreateView : Other)
        })
    })

    const wrapper = mount(Host, { global: { plugins: [testRouter] } })
    await flushPromises()

    const input = wrapper.find('input[placeholder="选填"]')
    expect(input.exists()).toBe(true)

    await input.setValue('上次填的备注')
    await flushPromises()
    expect((input.element as HTMLInputElement).value).toBe('上次填的备注')

    // 切到别的页面（新建页被 keep-alive 缓存起来）
    show.value = false
    await nextTick()
    await flushPromises()

    // 再切回新建页：组件被「复活」，onActivated 必须重置表单
    show.value = true
    await nextTick()
    await flushPromises()

    const input2 = wrapper.find('input[placeholder="选填"]')
    expect((input2.element as HTMLInputElement).value).toBe('')
  })

  it('静态契约：PurchaseCreateView 必须在 onActivated 里重置 form', () => {
    const src = readFileSync(
      resolve(__dirname, '../src/views/purchase/PurchaseCreateView.vue'),
      'utf-8'
    )
    expect(src, '必须有 onActivated 钩子').toContain('onActivated(')
    expect(src, '必须重置备注').toContain("form.remark = ''")
    expect(src, '必须重置已选商品').toContain('form.items = []')
    expect(src, '必须重置供应商').toContain('form.supplierId = 0')
  })
})
