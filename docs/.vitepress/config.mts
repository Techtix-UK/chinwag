import { defineConfig } from 'vitepress';

const base = '/chinwag/';

export default defineConfig({
  lang: 'en-GB',
  title: 'Chinwag',
  description: 'Self-hosted WhatsApp inbox, REST API and MCP server for AI assistants. Open source, by Techtix.',
  base,
  cleanUrls: true,
  lastUpdated: true,
  srcExclude: ['_old_*.md'],
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}logo.svg` }],
    ['meta', { name: 'theme-color', content: '#07182C' }],
    ['meta', { property: 'og:title', content: 'Chinwag — self-hosted WhatsApp inbox & MCP server' }],
    ['meta', { property: 'og:description', content: 'Run your WhatsApp accounts, team inbox, REST API and ChatGPT/MCP integration on your own server.' }],
    ['meta', { property: 'og:image', content: `https://techtix-uk.github.io${base}social-preview.png` }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
  ],
  themeConfig: {
    logo: '/logo.svg',
    siteTitle: 'Chinwag',
    nav: [
      { text: 'Guide', link: '/guide/introduction' },
      { text: 'Install', link: '/guide/installation' },
      { text: 'ChatGPT & MCP', link: '/integrations/chatgpt' },
      { text: 'API', link: '/integrations/rest-api' },
      { text: 'Changelog', link: 'https://github.com/Techtix-UK/chinwag/releases' },
    ],
    sidebar: [
      {
        text: 'Getting started',
        items: [
          { text: 'Introduction', link: '/guide/introduction' },
          { text: 'Requirements', link: '/guide/requirements' },
          { text: 'Installation', link: '/guide/installation' },
          { text: 'First-run setup', link: '/guide/first-run' },
          { text: 'HTTPS & reverse proxy', link: '/guide/reverse-proxy' },
          { text: 'Configuration', link: '/guide/configuration' },
        ],
      },
      {
        text: 'Using Chinwag',
        items: [
          { text: 'WhatsApp accounts', link: '/guide/accounts' },
          { text: 'Inbox & contacts', link: '/guide/inbox' },
          { text: 'Scheduling & approvals', link: '/guide/scheduling-approvals' },
          { text: 'Users & permissions', link: '/guide/users' },
        ],
      },
      {
        text: 'Integrations',
        items: [
          { text: 'ChatGPT (MCP)', link: '/integrations/chatgpt' },
          { text: 'MCP tools reference', link: '/integrations/mcp-tools' },
          { text: 'REST API', link: '/integrations/rest-api' },
          { text: 'Webhooks', link: '/integrations/webhooks' },
        ],
      },
      {
        text: 'Operations',
        items: [
          { text: 'The chinwag CLI', link: '/operations/cli' },
          { text: 'Upgrading', link: '/operations/upgrading' },
          { text: 'Backup & restore', link: '/operations/backup' },
          { text: 'Troubleshooting', link: '/operations/troubleshooting' },
          { text: 'Manual test checklist', link: '/operations/manual-testing' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'Security model', link: '/reference/security' },
          { text: 'Architecture', link: '/reference/architecture' },
          { text: 'Limitations', link: '/reference/limitations' },
          { text: 'FAQ', link: '/reference/faq' },
        ],
      },
    ],
    socialLinks: [{ icon: 'github', link: 'https://github.com/Techtix-UK/chinwag' }],
    editLink: { pattern: 'https://github.com/Techtix-UK/chinwag/edit/main/docs/:path', text: 'Edit this page on GitHub' },
    search: { provider: 'local' },
    footer: {
      message: 'Released under the AGPL-3.0 licence. Not affiliated with WhatsApp or Meta.',
      copyright: '© Techtix Global',
    },
  },
});
