<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue';

const props = withDefaults(defineProps<{ code: string; label?: string }>(), { label: 'TypeScript' });
const copied = ref(false);
const failed = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;
async function copy() {
  try {
    await navigator.clipboard.writeText(props.code);
    copied.value = true;
    failed.value = false;
    clearTimeout(timer);
    timer = setTimeout(() => {
      copied.value = false;
    }, 2000);
  } catch {
    failed.value = true;
  }
}
onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
  <div class="code-block">
    <div class="code-bar">
      <span>{{ label }}</span><button type="button" :aria-label="`Copy ${label} code`" @click="copy">
        {{ copied ? 'Copied' : 'Copy' }}
      </button>
    </div>
    <pre tabindex="0"><code>{{ code }}</code></pre>
    <span class="sr-only" role="status">{{
      copied ? 'Code copied to clipboard.' : failed ? 'Clipboard unavailable. Select the code to copy it.' : ''
    }}</span>
  </div>
</template>
