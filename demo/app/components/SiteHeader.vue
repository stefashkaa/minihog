<template>
  <header class="site-header">
    <div class="container header-inner">
      <NuxtLink class="wordmark" to="/" aria-label="MiniHog home"
        ><img src="/favicon.svg" alt="" width="34" height="34" />minihog<span class="wordmark-dot">.</span></NuxtLink
      >
      <nav class="main-nav" aria-label="Main navigation">
        <NuxtLink to="/docs">Docs</NuxtLink>
        <NuxtLink to="/playground">Playground</NuxtLink>
        <a class="github-link" href="https://github.com/stefashkaa/minihog" target="_blank" rel="noopener noreferrer"
          >GitHub <span aria-hidden="true">↗</span></a
        >
      </nav>
    </div>
  </header>
</template>
