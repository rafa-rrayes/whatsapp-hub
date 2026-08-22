// Dynamic-Cordis CLIENT half of the WhatsApp agent demo.
//
// Registers a "WhatsApp Agent" page in the DSH web Settings panel
// (`settings.section` slot) that shows live bridge status, edits the runtime
// config, and can fire a test send. It talks to the Host half through
// Package-private RPC (`host.call` → `harness.handle` on the Host).
//
// Client builtins: ctx, React, host, styles, console. No JSX — React.createElement only.

const CSS = `
.wa-panel{display:flex;flex-direction:column;gap:14px;font-size:13px;line-height:1.5}
.wa-card{border:1px solid color-mix(in srgb,currentColor 16%,transparent);border-radius:10px;padding:14px}
.wa-title{font-size:15px;font-weight:600}
.wa-sub{font-size:11px;opacity:.62}
.wa-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 14px;margin-top:8px}
.wa-k{opacity:.6;font-size:11px}
.wa-v{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;word-break:break-all}
.wa-field{display:flex;flex-direction:column;gap:4px;margin-top:10px}
.wa-field label{font-size:11px;opacity:.7}
.wa-input{background:transparent;border:1px solid color-mix(in srgb,currentColor 22%,transparent);border-radius:8px;padding:7px 9px;font-size:13px;color:inherit;width:100%;box-sizing:border-box}
.wa-input:focus{outline:none;border-color:#2f81f7}
.wa-btn{border:1px solid color-mix(in srgb,currentColor 22%,transparent);background:color-mix(in srgb,currentColor 8%,transparent);border-radius:8px;padding:7px 12px;font-size:13px;color:inherit;cursor:pointer}
.wa-btn:hover{border-color:#2f81f7}
.wa-btn.primary{background:#2f81f7;border-color:#2f81f7;color:#fff}
.wa-badge{display:inline-block;border-radius:999px;padding:2px 9px;font-size:11px;font-weight:600}
.wa-badge.live{background:#1a7f37;color:#fff}
.wa-badge.dry{background:#9a6700;color:#fff}
.wa-msg{font-size:12px;border-radius:8px;padding:8px 10px}
.wa-msg.ok{background:color-mix(in srgb,#1a7f37 16%,transparent)}
.wa-msg.err{background:color-mix(in srgb,#cf222e 16%,transparent)}
.wa-list{list-style:none;margin:0;padding:0}
.wa-list li{padding:4px 0;border-bottom:1px solid color-mix(in srgb,currentColor 10%,transparent);font-size:12px}
.wa-row{display:flex;gap:8px;align-items:flex-end}
.wa-row>*{flex:1}
.wa-row>button{flex:0 0 auto}
`

return {
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return

    const timer = ctx.get('timer')
    ctx.effect(() => styles.insert(CSS))

    function kv(k, v) {
      return React.createElement('div', null,
        React.createElement('div', { className: 'wa-k' }, k),
        React.createElement('div', { className: 'wa-v' }, v === undefined || v === null || v === '' ? '—' : String(v)),
      )
    }

    function Field({ label, value, onChange, type, placeholder }) {
      return React.createElement('div', { className: 'wa-field' },
        React.createElement('label', null, label),
        React.createElement('input', {
          className: 'wa-input',
          type: type || 'text',
          value: value,
          placeholder: placeholder || '',
          onChange: (e) => onChange(e.target.value),
        }),
      )
    }

    function Panel() {
      const [status, setStatus] = React.useState(null)
      const [cfg, setCfg] = React.useState({ hubUrl: '', apiKey: '', webhookSecret: '', pollMs: 60000 })
      const [msg, setMsg] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [testJid, setTestJid] = React.useState('5511999999999@s.whatsapp.net')
      const [testText, setTestText] = React.useState('Hello from the panel')

      const refresh = () => {
        host.call('wa_status').then(setStatus).catch((e) => console.error('wa_status', e))
        host.call('wa_getConfig').then((c) => {
          if (c) setCfg({ hubUrl: c.hubUrl || '', apiKey: '', webhookSecret: '', pollMs: c.pollMs || 60000 })
        }).catch(() => {})
      }

      React.useEffect(() => {
        refresh()
        if (timer) return timer.interval(refresh, 5000)
        return undefined
      }, [])

      const save = () => {
        setBusy(true); setMsg(null)
        const patch = { hubUrl: cfg.hubUrl, pollMs: Number(cfg.pollMs) || 0 }
        if (cfg.apiKey) patch.apiKey = cfg.apiKey
        if (cfg.webhookSecret) patch.webhookSecret = cfg.webhookSecret
        host.call('wa_setConfig', patch).then((r) => {
          setBusy(false)
          setMsg(r && r.ok
            ? { ok: true, text: 'Saved. Mode: ' + (r.echoMode ? 'dry-run (no API key)' : 'LIVE') + '. ' + (r.apiKeySet ? 'API key set.' : '') }
            : { ok: false, text: (r && r.error) || 'save failed' })
          refresh()
        }).catch((e) => { setBusy(false); setMsg({ ok: false, text: String((e && e.message) || e) }) })
      }

      const test = () => {
        setBusy(true); setMsg(null)
        host.call('wa_testSend', { jid: testJid, text: testText }).then((r) => {
          setBusy(false)
          setMsg(r && r.ok
            ? { ok: true, text: r.message || 'sent' }
            : { ok: false, text: (r && r.error) || (r && r.message) || 'send failed' })
          refresh()
        }).catch((e) => { setBusy(false); setMsg({ ok: false, text: String((e && e.message) || e) }) })
      }

      const st = status || {}
      const badge = st.echoMode
        ? React.createElement('span', { className: 'wa-badge dry' }, 'DRY-RUN')
        : React.createElement('span', { className: 'wa-badge live' }, 'LIVE')

      return React.createElement('div', { className: 'wa-panel' },
        React.createElement('div', { className: 'wa-card' },
          React.createElement('div', { className: 'wa-row' },
            React.createElement('div', null,
              React.createElement('div', { className: 'wa-title' }, 'WhatsApp Agent'),
              React.createElement('div', { className: 'wa-sub' }, 'DeepSeek Harness ⇄ whatsapp-hub bridge'),
            ),
            badge,
          ),
        ),

        React.createElement('div', { className: 'wa-card' },
          React.createElement('div', { className: 'wa-title', style: { fontSize: 13 } }, 'Status'),
          React.createElement('div', { className: 'wa-grid' },
            kv('Hub URL', st.hubUrl),
            kv('Agent session', st.agentSessionId),
            kv('Mode', st.echoMode ? 'dry-run' : 'live'),
            kv('Seen messages', st.seenMessages),
            kv('Tracked chats', st.chatsTracked),
            kv('Outbox pending', st.outboxPending),
            kv('API key', st.apiKeySet ? 'set' : 'none'),
            kv('Webhook secret', st.webhookSecretSet ? 'set' : 'none'),
          ),
        ),

        React.createElement('div', { className: 'wa-card' },
          React.createElement('div', { className: 'wa-title', style: { fontSize: 13 } }, 'Configuration'),
          React.createElement('div', { className: 'wa-sub', style: { marginTop: 2 } }, 'Leave a secret blank to keep the current value.'),
          React.createElement(Field, { label: 'Hub URL', value: cfg.hubUrl, onChange: (v) => setCfg({ ...cfg, hubUrl: v }) }),
          React.createElement(Field, { label: 'API key', type: 'password', placeholder: 'unchanged', value: cfg.apiKey, onChange: (v) => setCfg({ ...cfg, apiKey: v }) }),
          React.createElement(Field, { label: 'Webhook secret', type: 'password', placeholder: 'unchanged', value: cfg.webhookSecret, onChange: (v) => setCfg({ ...cfg, webhookSecret: v }) }),
          React.createElement(Field, { label: 'Reconcile poll (ms, 0 = off)', type: 'number', value: String(cfg.pollMs), onChange: (v) => setCfg({ ...cfg, pollMs: v }) }),
          React.createElement('div', { className: 'wa-row', style: { marginTop: 12 } },
            React.createElement('button', { className: 'wa-btn primary', disabled: busy, onClick: save }, busy ? 'Saving…' : 'Save config'),
          ),
        ),

        React.createElement('div', { className: 'wa-card' },
          React.createElement('div', { className: 'wa-title', style: { fontSize: 13 } }, 'Send a test message'),
          React.createElement(Field, { label: 'Recipient (phone or JID)', value: testJid, onChange: setTestJid }),
          React.createElement(Field, { label: 'Text', value: testText, onChange: setTestText }),
          React.createElement('div', { className: 'wa-row', style: { marginTop: 12 } },
            React.createElement('button', { className: 'wa-btn', disabled: busy, onClick: test }, busy ? 'Sending…' : 'Send'),
          ),
        ),

        msg ? React.createElement('div', { className: 'wa-msg ' + (msg.ok ? 'ok' : 'err') }, msg.text) : null,

        React.createElement('div', { className: 'wa-sub' },
          'Dynamic demo — ephemeral and resets when DSH restarts. Deploy the dsh/ package for a persistent panel.',
        ),
      )
    }

    slots.inject('settings.section', () => slots.register(
      { name: 'settings.section', id: 'whatsapp', order: 30, label: 'WhatsApp Agent' },
      (props) => React.createElement(Panel, props),
    ))
  },
}
