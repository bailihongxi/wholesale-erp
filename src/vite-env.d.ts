/// <reference types="vite/client" />

/**
 * Vite 环境变量与静态资源类型（第十六轮补）。
 * 之前项目里没用到 import.meta.env，所以一直没引；注册 Service Worker 与
 * 判断生产环境时用到了 PROD / BASE_URL，缺这份声明 vue-tsc 会报 TS2339。
 */
