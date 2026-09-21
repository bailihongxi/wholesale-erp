<template>
  <!--
    品牌与图标（第十二轮）
    登录页标志 / 侧边栏标志 / 系统名称 / 各角色头像 / 网页版快捷图标，
    统一在这里维护；保存即写 localStorage 并全站即时生效。
  -->
  <CollapseCard v-model="openProxy" title="品牌与图标">
    <p class="tip block-tip">
      登录页标志、系统名称、各角色头像，以及网页版（侧边栏 / 手机端底部 Tab / 业务中心）的
      <b>快捷图标</b> 都可以在这里改。改完点一下输入框外面立即全站生效，不需要刷新。
      图标支持 emoji 或 1~6 个字，也可上传一张图片（会自动压成 128px 方图）。
    </p>

    <!-- ===== 标志与名称 ===== -->
    <div class="bs-sub">标志与名称</div>
    <div class="bs-row" v-for="row in logoRows" :key="row.key">
      <span class="bs-label">{{ row.label }}</span>
      <span class="bs-prev" :class="{ 'is-img': row.icon.type === 'image' }">
        <img v-if="row.icon.type === 'image'" :src="row.icon.value" alt="" />
        <template v-else>{{ row.icon.value }}</template>
      </span>
      <input
        class="ui-input bs-text"
        maxlength="6"
        placeholder="Emoji / 文字"
        :value="row.icon.type === 'text' ? row.icon.value : ''"
        @input="setLogo(row.key, { type: 'text', value: textOf($event) })"
      />
      <label class="ui-btn ui-btn-sm bs-upload">
        🖼 上传图片
        <input type="file" accept="image/*" @change="uploadLogo(row.key, $event)" />
      </label>
      <button class="ui-btn ui-btn-sm" type="button" @click="setLogo(row.key, { type: 'text', value: row.fallback })">
        恢复默认
      </button>
    </div>

    <div class="bs-row bs-row-name">
      <span class="bs-label">系统名称</span>
      <input
        class="ui-input"
        placeholder="系统名称"
        :value="titleDraft"
        @input="titleDraft = textOf($event)"
        @blur="saveLoginText"
      />
      <input
        class="ui-input"
        placeholder="副标题"
        :value="subDraft"
        @input="subDraft = textOf($event)"
        @blur="saveLoginText"
      />
    </div>

    <!-- ===== 各角色头像 ===== -->
    <div class="bs-sub">各角色头像</div>
    <div class="bs-row" v-for="r in AVATAR_ROLES" :key="r">
      <span class="bs-label">{{ roleLabelOf(r) }}</span>
      <span class="bs-prev" :class="{ 'is-img': avatarOf(r).type === 'image' }">
        <img v-if="avatarOf(r).type === 'image'" :src="avatarOf(r).value" alt="" />
        <template v-else>{{ avatarOf(r).value }}</template>
      </span>
      <input
        class="ui-input bs-text"
        maxlength="6"
        placeholder="Emoji / 文字"
        :value="avatarOf(r).type === 'text' ? avatarOf(r).value : ''"
        @input="setRoleAvatar(r, { type: 'text', value: textOf($event) })"
      />
      <label class="ui-btn ui-btn-sm bs-upload">
        🖼 上传图片
        <input type="file" accept="image/*" @change="uploadAvatar(r, $event)" />
      </label>
      <button
        class="ui-btn ui-btn-sm"
        type="button"
        @click="setRoleAvatar(r, { type: 'text', value: DEFAULT_ROLE_AVATARS[r] ?? '👤' })"
      >
        恢复默认
      </button>
    </div>
    <div class="bs-actions">
      <button class="ui-btn ui-btn-sm" type="button" @click="resetRoleAvatars">↺ 全部角色头像恢复默认</button>
    </div>

    <!-- ===== 快捷图标 ===== -->
    <div class="bs-sub">网页版快捷图标</div>
    <div class="bs-icons">
      <label v-for="m in modules" :key="m.route" class="bs-icon-cell">
        <span class="bs-icon-prev">{{ iconOf(m) }}</span>
        <input
          class="ui-input bs-icon-input"
          maxlength="4"
          :placeholder="m.icon"
          :value="config.moduleIcons[m.route] ?? ''"
          @input="setModuleIcon(m.route, textOf($event))"
        />
        <span class="bs-icon-name">{{ m.label }}</span>
      </label>
    </div>
    <div class="bs-actions">
      <button class="ui-btn ui-btn-sm" type="button" @click="resetModuleIcons">↺ 快捷图标恢复默认</button>
      <button class="ui-btn ui-btn-sm" type="button" @click="resetEverything">↺ 全部恢复出厂设置</button>
    </div>
  </CollapseCard>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { showToast } from 'vant'
import CollapseCard from './ui/CollapseCard.vue'
import {
  useBrand, AVATAR_ROLES, DEFAULT_ROLE_AVATARS, DEFAULT_SYSTEM_NAME, roleLabelOf, type BrandIcon
} from '../utils/brand'
import { fileToSquareDataUrl } from '../utils/image'

/** 折叠状态由系统设置页统一托管（全部展开 / 全部收起要能一起动） */
const props = withDefaults(defineProps<{ open?: boolean }>(), { open: true })
const emit = defineEmits<{ (e: 'update:open', v: boolean): void }>()
const openProxy = computed({
  get: () => props.open,
  set: (v: boolean) => emit('update:open', v)
})

const {
  config, modules, iconOf, roleAvatar,
  setLoginLogo, setSideLogo, setLoginText, setModuleIcon, setRoleAvatar,
  resetModuleIcons, resetRoleAvatars, resetAll
} = useBrand()

/** 登录页 / 侧边栏两行标志共用同一套编辑器 */
const logoRows = computed(() => [
  { key: 'login' as const, label: '登录页标志', icon: config.value.loginLogo, fallback: 'ERP' },
  { key: 'side' as const, label: '侧边栏标志', icon: config.value.sideLogo, fallback: 'ERP' }
])

const titleDraft = ref(config.value.loginTitle)
const subDraft = ref(config.value.loginSub)

function textOf(e: Event): string {
  return (e.target as HTMLInputElement).value
}

function avatarOf(role: string): BrandIcon {
  return roleAvatar(role)
}

function setLogo(kind: 'login' | 'side', icon: BrandIcon): void {
  if (kind === 'login') setLoginLogo(icon)
  else setSideLogo(icon)
}

async function uploadLogo(kind: 'login' | 'side', e: Event): Promise<void> {
  const url = await pickImage(e)
  if (!url) return
  setLogo(kind, { type: 'image', value: url })
  showToast('标志已更新')
}

async function uploadAvatar(role: string, e: Event): Promise<void> {
  const url = await pickImage(e)
  if (!url) return
  setRoleAvatar(role, { type: 'image', value: url })
  showToast(`${roleLabelOf(role)}头像已更新`)
}

/** 读取用户选的图片并压成 128px 方图；无文件 / 读取失败返回空串 */
async function pickImage(e: Event): Promise<string> {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return ''
  try {
    return await fileToSquareDataUrl(file, 128)
  } catch {
    showToast('图片读取失败，请换一张')
    return ''
  } finally {
    // 清空 input，否则选同一张图不会再次触发 change
    input.value = ''
  }
}

function saveLoginText(): void {
  const title = titleDraft.value.trim() || DEFAULT_SYSTEM_NAME
  const sub = subDraft.value.trim()
  titleDraft.value = title
  subDraft.value = sub
  setLoginText(title, sub)
}

function resetEverything(): void {
  resetAll()
  titleDraft.value = config.value.loginTitle
  subDraft.value = config.value.loginSub
  showToast('已恢复出厂设置')
}
</script>

<style scoped>
.bs-sub {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 18px 0 10px;
  font-size: 13px;
  font-weight: 700;
  color: var(--c-primary);
}
.bs-sub::before {
  content: '';
  width: 3px;
  height: 13px;
  border-radius: 2px;
  background: var(--c-accent);
}
.bs-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px dashed var(--c-border);
  flex-wrap: wrap;
}
.bs-row:last-of-type { border-bottom: none; }
.bs-label {
  width: 96px;
  flex: none;
  font-size: 13px;
  color: var(--c-text-2);
}
.bs-prev {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  flex: none;
  border-radius: var(--r-sm);
  border: 1px solid var(--c-border-strong);
  background: var(--c-surface-alt);
  font-size: 18px;
  overflow: hidden;
}
.bs-prev.is-img { background: #fff; }
.bs-prev img { width: 100%; height: 100%; object-fit: cover; display: block; }
.bs-text { width: 150px; flex: none; }
.bs-row-name .ui-input { width: 220px; flex: none; }
.bs-upload { position: relative; overflow: hidden; }
.bs-upload input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
.bs-actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 12px; }

.bs-icons {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 8px 12px;
}
.bs-icon-cell {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 1px solid var(--c-border);
  border-radius: var(--r-sm);
  background: var(--c-surface-alt);
}
.bs-icon-prev { font-size: 17px; flex: none; width: 22px; text-align: center; }
.bs-icon-input { width: 56px; flex: none; height: 32px; padding: 0 8px; text-align: center; }
.bs-icon-name {
  font-size: 12px;
  color: var(--c-text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
