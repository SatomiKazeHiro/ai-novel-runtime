<template>
  <n-layout style="height: 100vh; display: flex; flex-direction: column;">
    <NavBar />
    <n-layout-content style="padding: 24px; overflow-y: auto; flex: 1;">
      <router-view />
    </n-layout-content>
  </n-layout>
</template>

<script setup lang="ts">
import { NLayout, NLayoutContent } from 'naive-ui'
import NavBar from '../components/NavBar.vue'
</script>
