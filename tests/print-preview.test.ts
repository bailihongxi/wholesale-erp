import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import PrintPreview from '../src/components/PrintPreview.vue'

/**
 * 打印预览弹窗：必须先预览、再由用户点「打印」或「取消」，
 * 不允许直接静默弹出打印窗口。
 */
describe('打印预览弹窗', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  const sampleHtml = '<!DOCTYPE html><html><body><h1>采购单 CG001</h1></body></html>'

  it('visible=false 时不渲染任何内容', () => {
    const wrapper = mount(PrintPreview, {
      props: { visible: false, title: '采购单', html: sampleHtml }
    })
    expect(wrapper.find('.pp-dialog').exists()).toBe(false)
  })

  it('visible=true 时展示预览，并在 iframe 中渲染单据 HTML', () => {
    const wrapper = mount(PrintPreview, {
      props: { visible: true, title: '采购单 CG001', html: sampleHtml }
    })
    expect(wrapper.find('.pp-dialog').exists()).toBe(true)
    expect(wrapper.find('.pp-title').text()).toBe('采购单 CG001')
    expect(wrapper.find('.pp-frame').attributes('srcdoc')).toBe(sampleHtml)
  })

  it('底部同时提供「取消」和「打印」两个按钮', () => {
    const wrapper = mount(PrintPreview, {
      props: { visible: true, title: '单据', html: sampleHtml }
    })
    const texts = wrapper.findAll('.pp-btn').map(b => b.text())
    expect(texts).toContain('取消')
    expect(texts.some(t => t.includes('打印'))).toBe(true)
  })

  it('点击「取消」只关闭预览，不触发任何打印动作', async () => {
    const wrapper = mount(PrintPreview, {
      props: { visible: true, title: '单据', html: sampleHtml }
    })
    const openSpy = vi.spyOn(window, 'open')

    await wrapper.find('.pp-btn.ghost').trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('cancel')).toBeTruthy()
    expect(openSpy).not.toHaveBeenCalled()
    expect(wrapper.emitted('print')).toBeFalsy()
    openSpy.mockRestore()
  })

  it('点击「打印」会真正调用打印并发出 print 事件', async () => {
    const wrapper = mount(PrintPreview, {
      props: { visible: true, title: '单据', html: sampleHtml }
    })
    // jsdom 下 iframe 的 print 可能不可用，此处直接给 iframe 装上可观测的 print
    const frame = wrapper.find('.pp-frame').element as HTMLIFrameElement
    const printSpy = vi.fn()
    Object.defineProperty(frame, 'contentWindow', {
      configurable: true,
      value: { focus: vi.fn(), print: printSpy }
    })

    await wrapper.find('.pp-btn.primary').trigger('click')
    await wrapper.vm.$nextTick()

    expect(printSpy).toHaveBeenCalled()
    expect(wrapper.emitted('print')).toBeTruthy()
  })

  it('iframe 不支持打印时回退到新窗口打印，保证功能不失效', async () => {
    const wrapper = mount(PrintPreview, {
      props: { visible: true, title: '单据', html: sampleHtml }
    })
    const frame = wrapper.find('.pp-frame').element as HTMLIFrameElement
    Object.defineProperty(frame, 'contentWindow', {
      configurable: true,
      value: null
    })

    let written = ''
    const fakeWin = {
      document: {
        open: vi.fn(),
        write: vi.fn((h: string) => { written += h }),
        close: vi.fn()
      },
      focus: vi.fn(),
      print: vi.fn()
    }
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(fakeWin as unknown as Window)

    await wrapper.find('.pp-btn.primary').trigger('click')
    await wrapper.vm.$nextTick()

    expect(openSpy).toHaveBeenCalled()
    expect(written).toContain('采购单 CG001')
    openSpy.mockRestore()
  })

  it('含单价开关可切换并向外同步 v-model', async () => {
    const wrapper = mount(PrintPreview, {
      props: {
        visible: true,
        title: '单据',
        html: sampleHtml,
        allowPriceToggle: true,
        showPrice: true
      }
    })
    const toggle = wrapper.find('.pp-toggle input')
    expect((toggle.element as HTMLInputElement).checked).toBe(true)

    await toggle.setValue(false)
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('update:showPrice')?.[0]).toEqual([false])
  })

  it('allowPriceToggle=false 时不显示含单价开关', () => {
    const wrapper = mount(PrintPreview, {
      props: {
        visible: true,
        title: '单据',
        html: sampleHtml,
        allowPriceToggle: false
      }
    })
    expect(wrapper.find('.pp-toggle').exists()).toBe(false)
  })
})
