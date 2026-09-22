/**
 * useEditMode —— 详情页「修改」功能的通用状态机
 *
 * 从销售单详情页（V2.0-25）归纳出来的通用编辑模式：
 *  - showEdit：是否处于编辑态（驱动详情页与编辑面板的切换）
 *  - saving：保存中的加载态（禁用按钮，避免重复提交）
 *  - startEdit()：进入编辑态；电脑端（≥768px）自动把视口滚到编辑区，
 *                 否则点「修改」后画面像「没反应」。手机端编辑页是整屏 fixed，无需滚动。
 *  - closeEdit()：退出编辑态；关掉后详情页变短、视口可能停在空白，
 *                 于是把底部操作栏（详情页的橘色「返回」键，编辑时被 v-if 收起，
 *                 模块一关就自动回来）滚回视野。
 *
 * 用法（配合 <EditModePanel>）：
 *   const { showEdit, saving, startEdit, closeEdit } = useEditMode()
 *   const editItems = ref([])
 *   async function beginEdit() {
 *     editItems.value = items.value.map(...)   // 拷贝可编辑副本
 *     await startEdit()                          // 设 showEdit=true + 滚动
 *   }
 *   async function onCancel() { await closeEdit() }          // 取消即关闭
 *   async function onSave() {
 *     saving.value = true
 *     const res = await store.updateOrder(...)
 *     saving.value = false
 *     if (res.ok) { showToast('已保存'); await closeEdit(); await loadOrder() }
 *   }
 */
import { ref, nextTick } from 'vue'

export interface UseEditModeOptions {
  /** 进入编辑态后，电脑端要滚到的目标选择器；传空则不滚动。默认不滚动。 */
  scrollSelectorOnStart?: string
  /** 关闭编辑态后要把哪个元素滚回视野；默认 '.page-actions'（详情页底部操作栏）。 */
  scrollSelectorOnClose?: string
}

export function useEditMode(options: UseEditModeOptions = {}) {
  const showEdit = ref(false)
  const saving = ref(false)

  /** 进入编辑态。页面级拷贝逻辑（editItems/editRemark 等）请在调用前完成。 */
  async function startEdit(): Promise<void> {
    showEdit.value = true
    await nextTick()
    const sel = options.scrollSelectorOnStart
    if (sel && typeof window !== 'undefined' && window.innerWidth >= 768) {
      document.querySelector(sel)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  /** 退出编辑态，并把详情页底部操作栏（橘色「返回」）滚回视野。 */
  async function closeEdit(): Promise<void> {
    showEdit.value = false
    await nextTick()
    const sel = options.scrollSelectorOnClose ?? '.page-actions'
    if (typeof window !== 'undefined' && sel) {
      document.querySelector(sel)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }

  return { showEdit, saving, startEdit, closeEdit }
}
