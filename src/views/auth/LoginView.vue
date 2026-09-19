<template>
  <div class="login-page" :class="isMobile ? 'is-mobile' : 'is-desktop'">
    <!-- 电脑端：左侧品牌区 -->
    <section v-if="!isMobile" class="brand-panel">
      <div class="brand-inner">
        <div class="brand-logo">ERP</div>
        <h1 class="brand-title">家电批发ERP</h1>
        <p class="brand-sub">进货 · 库存 · 销售 · 对账 全流程管理</p>
        <ul class="brand-feats">
          <li>📦 商品档案统一管理</li>
          <li>🔄 采购入库 / 销售出库闭环</li>
          <li>📊 老板实时经营看板</li>
          <li>🤝 经销商自助查产品</li>
        </ul>
      </div>
    </section>

    <!-- 右侧 / 下方：表单区 -->
    <section class="form-panel">
      <div class="login-card">
        <!-- 手机端：渐变头部 + 头像 -->
        <div v-if="isMobile" class="mobile-header">
          <div class="avatar">👤</div>
          <h1 class="system-name">家电批发ERP</h1>
          <p class="system-sub">家电批发进销存管理系统</p>
        </div>

        <template v-else>
          <h2 class="form-title">账号登录</h2>
        </template>

        <div class="field">
          <span class="field-icon">📱</span>
          <input v-model="phone" class="field-input" type="tel" placeholder="请输入手机号" />
        </div>
        <div class="field">
          <span class="field-icon">🔒</span>
          <input v-model="password" class="field-input" type="password" placeholder="请输入密码" />
        </div>

        <button class="login-btn" type="button" :disabled="loading" @click="handleLogin">
          {{ loading ? '登录中…' : '登 录' }}
        </button>

        <p class="hint">默认账号：13800000000 / admin123</p>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { showToast } from 'vant'
import { useUserStore } from '../../stores/user'
import { useResponsive } from '../../composables/useResponsive'

const router = useRouter()
const userStore = useUserStore()
const { isMobile } = useResponsive()

const phone = ref('')
const password = ref('')
const loading = ref(false)

async function handleLogin(): Promise<void> {
  if (!phone.value || !password.value) {
    showToast('请输入手机号和密码')
    return
  }
  loading.value = true
  const res = await userStore.login(phone.value, password.value)
  loading.value = false
  if (res.ok) {
    showToast('登录成功')
    router.push(userStore.homeRouteForRole(userStore.role))
  } else {
    showToast(res.message)
  }
}
</script>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  background: var(--c-bg);
}
/* 电脑端左右分栏 */
.login-page.is-desktop {
  flex-direction: row;
}
.brand-panel {
  flex: 1.15;
  position: relative;
  background:
    radial-gradient(900px 380px at 15% 12%, rgba(255, 255, 255, .14) 0%, transparent 60%),
    linear-gradient(135deg, #16325c 0%, #24508f 55%, #2f6bff 100%);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
/* 装饰圆环，让品牌区不至于是一块死板的纯色 */
.brand-panel::after {
  content: '';
  position: absolute;
  right: -120px;
  bottom: -140px;
  width: 340px;
  height: 340px;
  border-radius: 50%;
  border: 46px solid rgba(255, 255, 255, .07);
}
.brand-inner {
  position: relative;
  z-index: 1;
  max-width: 380px;
  padding: 32px;
}
.brand-logo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 58px;
  height: 58px;
  border-radius: 16px;
  background: rgba(255, 255, 255, .16);
  border: 1px solid rgba(255, 255, 255, .28);
  box-shadow: 0 6px 18px rgba(0, 0, 0, .16);
  font-weight: 800;
  letter-spacing: .5px;
  margin-bottom: 20px;
}
.brand-title {
  font-size: 30px;
  letter-spacing: 1px;
  margin-bottom: 8px;
}
.brand-sub {
  opacity: .85;
  margin-bottom: 28px;
  font-size: 14px;
}
.brand-feats {
  list-style: none;
  line-height: 2.2;
  opacity: .92;
  font-size: 14px;
}
.form-panel {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.login-card {
  width: 100%;
  max-width: 372px;
  background: #fff;
  border: 1px solid var(--c-border);
  border-radius: var(--r-lg);
  padding: 30px 26px;
  box-shadow: var(--sh-lg);
}
.form-title {
  text-align: center;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 1px;
  margin-bottom: 24px;
  color: var(--c-primary);
}
/* 手机端头部 */
.mobile-header {
  text-align: center;
  background: linear-gradient(135deg, #1a365d 0%, #2563eb 100%);
  margin: -28px -24px 24px;
  padding: 32px 24px;
  border-radius: 14px 14px 0 0;
  color: #fff;
}
.avatar {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.25);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 36px;
  margin-bottom: 12px;
}
.system-name {
  font-size: 22px;
}
.system-sub {
  font-size: 12px;
  opacity: 0.85;
  margin-top: 4px;
}
.field {
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid var(--c-border-strong);
  border-radius: var(--r-md);
  padding: 0 14px;
  height: 50px;
  margin-bottom: 14px;
  background: var(--c-surface-alt);
  transition: border-color .15s ease, box-shadow .15s ease, background .15s ease;
}
.field:focus-within {
  background: #fff;
  border-color: var(--c-accent);
  box-shadow: 0 0 0 3px rgba(47, 107, 255, .12);
}
.field-icon {
  font-size: 18px;
  opacity: .8;
}
.field-input {
  flex: 1;
  border: none;
  outline: none;
  font-size: 15px;
  height: 100%;
  background: transparent;
  color: var(--c-text);
}
.field-input::placeholder { color: var(--c-muted); }
.login-btn {
  width: 100%;
  height: 48px;
  border: none;
  border-radius: var(--r-md);
  background: linear-gradient(135deg, #2f6bff 0%, #1e5bef 100%);
  color: #fff;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 2px;
  cursor: pointer;
  margin-top: 8px;
  box-shadow: 0 6px 18px rgba(47, 107, 255, .3);
  transition: transform .15s ease, box-shadow .15s ease;
}
.login-btn:hover { transform: translateY(-1px); box-shadow: 0 8px 24px rgba(47, 107, 255, .38); }
.login-btn:disabled {
  opacity: 0.7;
  cursor: default;
  transform: none;
  box-shadow: none;
}
.hint {
  margin-top: 16px;
  text-align: center;
  font-size: 12px;
  color: var(--c-muted);
}
/* 手机端上下布局 */
.login-page.is-mobile {
  flex-direction: column;
}
.login-page.is-mobile .form-panel {
  flex: none;
}
</style>
