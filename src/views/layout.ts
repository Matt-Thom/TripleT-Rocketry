/**
 * Base HTML page layout shell for TripleT-Rocketry.
 *
 * Provides a responsive dark-theme layout using Tailwind CSS Play CDN and HTMX,
 * featuring a desktop top navigation header and a mobile-optimized thumb-friendly
 * "Range Companion" bottom navigation bar.
 */

import { html } from 'hono/html'
import type { HtmlEscapedString } from 'hono/utils/html'

export type NavTab = 'dashboard' | 'flights' | 'rockets' | 'motors' | 'inventory' | 'sites' | 'events'

export interface PageLayoutOptions {
  title: string
  activeTab: NavTab
  content: HtmlEscapedString | Promise<HtmlEscapedString> | string
}

export function pageLayout(options: {
  title: string
  activeTab: NavTab
  content: HtmlEscapedString | Promise<HtmlEscapedString> | string
}): HtmlEscapedString | Promise<HtmlEscapedString> {
  const { title, activeTab, content } = options

  const desktopNavLinkClass = (tab: NavTab) =>
    activeTab === tab
      ? 'bg-brand-600 text-white px-3 py-2 rounded-md text-sm font-medium transition-colors'
      : 'text-slate-300 hover:bg-slate-800 hover:text-white px-3 py-2 rounded-md text-sm font-medium transition-colors'

  const mobileNavLinkClass = (tab: NavTab) =>
    activeTab === tab
      ? 'flex flex-col items-center justify-center text-brand-400 text-xs font-semibold py-1 transition-colors'
      : 'flex flex-col items-center justify-center text-slate-400 hover:text-slate-200 text-xs py-1 transition-colors'

  return html`<!DOCTYPE html>
<html lang="en" class="h-full bg-slate-900 text-slate-100">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${title} — TripleT-Rocketry</title>
  <!-- Tailwind CSS Play CDN -->
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            brand: {
              50: '#ecfdf5',
              100: '#d1fae5',
              200: '#a7f3d0',
              300: '#6ee7b7',
              400: '#34d399',
              500: '#10b981',
              600: '#059669',
              700: '#047857',
              800: '#065f46',
              900: '#064e3b',
            },
            slate: {
              850: '#162032',
              950: '#0b1120',
            }
          }
        }
      }
    }
  </script>
  <!-- HTMX v2.0.4 CDN -->
  <script src="https://unpkg.com/htmx.org@2.0.4"></script>
</head>
<body class="h-full min-h-screen flex flex-col bg-slate-900 text-slate-100 antialiased selection:bg-brand-500 selection:text-slate-950">

  <!-- Desktop Top Navigation (>= 768px) -->
  <header class="bg-slate-950 border-b border-slate-800 sticky top-0 z-40">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="flex items-center justify-between h-16">
        <div class="flex items-center space-x-8">
          <a href="/" class="flex items-center space-x-2 text-white font-bold text-lg hover:text-brand-400 transition-colors">
            <span class="text-2xl">🚀</span>
            <span class="tracking-tight">TripleT-Rocketry</span>
          </a>
          <nav class="hidden md:flex space-x-2" aria-label="Main navigation">
            <a href="/" class="${desktopNavLinkClass('dashboard')}">Dashboard</a>
            <a href="/flights" class="${desktopNavLinkClass('flights')}">Flights</a>
            <a href="/rockets" class="${desktopNavLinkClass('rockets')}">Rockets</a>
            <a href="/motors" class="${desktopNavLinkClass('motors')}">Motors</a>
            <a href="/inventory" class="${desktopNavLinkClass('inventory')}">Inventory</a>
            <a href="/sites" class="${desktopNavLinkClass('sites')}">Sites</a>
            <a href="/events" class="${desktopNavLinkClass('events')}">Events</a>
          </nav>
        </div>

        <div class="flex items-center space-x-3">
          <a href="/flights/new" class="inline-flex items-center px-3.5 py-1.5 border border-transparent text-sm font-semibold rounded-md shadow-sm text-slate-950 bg-brand-400 hover:bg-brand-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-500 focus:ring-offset-slate-900 transition-colors">
            <span class="mr-1">+</span> Log Flight
          </a>
        </div>
      </div>
    </div>
  </header>

  <!-- Mobile Top Bar (< 768px) -->
  <div class="md:hidden bg-slate-950/80 backdrop-blur border-b border-slate-800 px-4 py-3 flex items-center justify-between sticky top-0 z-30">
    <a href="/" class="flex items-center space-x-2 font-bold text-white">
      <span class="text-xl">🚀</span>
      <span>TripleT</span>
    </a>
    <a href="/flights/new" class="text-xs bg-brand-400 text-slate-950 font-bold px-2.5 py-1 rounded shadow hover:bg-brand-300 transition-colors">
      + Log Flight
    </a>
  </div>

  <!-- Main Content Body -->
  <main class="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-24 md:pb-10">
    ${content}
  </main>

  <!-- Mobile Range Companion Bottom Navigation (< 768px) -->
  <nav class="md:hidden fixed bottom-0 inset-x-0 bg-slate-950/95 border-t border-slate-800 backdrop-blur z-50 px-2 py-1 flex justify-around items-center" aria-label="Mobile navigation">
    <a href="/" class="${mobileNavLinkClass('dashboard')} flex-1 text-center">
      <span class="text-lg leading-none mb-1 block">📊</span>
      <span>Dashboard</span>
    </a>
    <a href="/flights" class="${mobileNavLinkClass('flights')} flex-1 text-center">
      <span class="text-lg leading-none mb-1 block">🚀</span>
      <span>Flights</span>
    </a>
    <a href="/rockets" class="${mobileNavLinkClass('rockets')} flex-1 text-center">
      <span class="text-lg leading-none mb-1 block">🛰️</span>
      <span>Rockets</span>
    </a>
    <a href="/motors" class="${mobileNavLinkClass('motors')} flex-1 text-center">
      <span class="text-lg leading-none mb-1 block">⚡</span>
      <span>Motors</span>
    </a>
    <a href="/inventory" class="${mobileNavLinkClass('inventory')} flex-1 text-center">
      <span class="text-lg leading-none mb-1 block">📦</span>
      <span>Inventory</span>
    </a>
    <a href="/sites" class="${mobileNavLinkClass('sites')} flex-1 text-center">
      <span class="text-lg leading-none mb-1 block">📍</span>
      <span>Sites</span>
    </a>
  </nav>

</body>
</html>`
}
