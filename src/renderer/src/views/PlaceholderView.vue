<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

/** 尚未实现的功能统一落在这里，避免侧边栏点进空路由导致白屏。 */
const route = useRoute()
const title = computed(() => (route.meta.title as string | undefined) ?? '功能')
</script>

<template>
  <div class="page">
    <el-empty :description="`${title}功能开发中，当前版本暂不可用`" />
  </div>
</template>
