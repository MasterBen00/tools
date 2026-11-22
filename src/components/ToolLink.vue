<script setup lang="ts">
import { RouterLink } from "vue-router";
import { isExternal, type ListedTool } from "@/tools/registry";

// Local tools are router links; external tools (mock.baniamin.com, hook.baniamin.com) open in a new tab.
defineProps<{ tool: ListedTool; activeClass?: string }>();
</script>

<template>
    <a v-if="isExternal(tool)" :href="tool.href" target="_blank" rel="noopener" :title="`Opens ${tool.href.replace('https://', '')} in a new tab`"><slot /></a>
    <RouterLink v-else :to="'/' + tool.id" :active-class="activeClass"><slot /></RouterLink>
</template>
