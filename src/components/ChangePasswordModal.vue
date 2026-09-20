<template>
  <div v-if="open" class="cp-mask" @click.self="close">
    <div class="cp-modal">
      <div class="cp-head">
        <b>修改密码</b>
        <button class="cp-x" type="button" @click="close">✕</button>
      </div>
      <div class="cp-body">
        <label class="ui-field">
          <span class="ui-label">原密码<span class="cp-req">*</span></span>
          <input v-model="oldPwd" class="ui-input" type="password" autocomplete="current-password" placeholder="当前登录密码" />
        </label>
        <label class="ui-field">
          <span class="ui-label">新密码<span class="cp-req">*</span></span>
          <input v-model="newPwd" class="ui-input" type="password" autocomplete="new-password" :placeholder="`至少 ${PASSWORD_MIN_LEN} 位`" />
        </label>
        <label class="ui-field">
          <span class="ui-label">确认新密码<span class="cp-req">*</span></span>
          <input v-model="confirmPwd" class="ui-input" type="password" autocomplete="new-password" placeholder="再输入一次" />
        </label>
        <p class="ui-hint cp-tip">密码以不可逆哈希保存，忘记后只能由老板在「员工管理」里重置。</p>
      </div>
      <div class="cp-foot">
        <button class="ui-btn ui-btn-cancel" type="button" @click="close">取消</button>
        <button class="ui-btn ui-btn-primary" type="button" :disabled="saving" @click="submit">
          {{ saving ? '保存中…' : '确认修改' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { showToast } from 'vant'
import { useUserStore } from '../stores/user'
import { PASSWORD_MIN_LEN } from '../utils/password'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'changed'): void
}>()

const userStore = useUserStore()
const oldPwd = ref('')
const newPwd = ref('')
const confirmPwd = ref('')
const saving = ref(false)

// 每次打开都清空，避免上一次的输入残留（密码不该留在屏幕上）
watch(() => props.open, v => {
  if (v) {
    oldPwd.value = ''
    newPwd.value = ''
    confirmPwd.value = ''
  }
})

function close(): void {
  emit('update:open', false)
}

async function submit(): Promise<void> {
  // 经销商账号在客户表里，不走员工改密通道
  if (userStore.role === 'dealer') {
    showToast('经销商账号请联系管理员修改')
    return
  }
  const id = userStore.currentUser?.id
  if (!id) {
    showToast('登录状态已失效，请重新登录')
    return
  }
  if (!oldPwd.value) {
    showToast('请输入原密码')
    return
  }
  if (newPwd.value.length < PASSWORD_MIN_LEN) {
    showToast(`新密码不能少于 ${PASSWORD_MIN_LEN} 位`)
    return
  }
  if (newPwd.value !== confirmPwd.value) {
    showToast('两次输入的新密码不一致')
    return
  }
  saving.value = true
  const res = await userStore.changePassword(id, oldPwd.value, newPwd.value)
  saving.value = false
  showToast(res.message)
  if (res.ok) {
    close()
    emit('changed')
  }
}
</script>

<style scoped>
.cp-mask {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(16, 32, 60, .42);
}
.cp-modal {
  width: 100%;
  max-width: 440px;
  background: var(--c-surface);
  border-radius: var(--r-lg);
  box-shadow: var(--sh-lg);
  overflow: hidden;
}
.cp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--c-border);
  color: var(--c-primary);
}
.cp-x {
  border: none;
  background: none;
  cursor: pointer;
  font-size: 15px;
  color: var(--c-muted);
}
.cp-body {
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.cp-req { color: #dc2626; margin-left: 2px; }
.cp-tip { line-height: 1.6; }
.cp-foot {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 12px 18px;
  border-top: 1px solid var(--c-border);
  background: var(--c-surface-alt);
}
</style>
