/**
 * Client half of @rafa/dsh-whatsapp-agent — a "WhatsApp Agent" settings page.
 *
 * Registers a `settings.section` in the DSH web Settings panel showing live
 * bridge status, runtime config editing, and a test-send. It talks to the Host
 * half through the Host's same-origin web routes (see index.js):
 *
 *   GET  /whatsapp/panel/status
 *   GET  /whatsapp/panel/config      POST /whatsapp/panel/config
 *   POST /whatsapp/panel/test-send
 *
 * This file is the CLIENT bundle source. It is compiled by the deployment's
 * client-module build (the `dsh.client` declaration in package.json) and is NOT
 * part of the dynamic-Cordis demo (that one uses `host.call`).
 *
 * Style note: it uses inline styles + `slots` only — no `styles`/`document`
 * access — so it ports cleanly to the permanent client runtime.
 */

import React from 'react'

export const name = 'whatsapp-agent-client'

const api = {
  status: () => fetch('/whatsapp/panel/status').then((r) => r.json()),
  config: () => fetch('/whatsapp/panel/config').then((r) => r.json()),
  save: (patch) => fetch('/whatsapp/panel/config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  }).then((r) => r.json()),
  test: (patch) => fetch('/whatsapp/panel/test-send', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  }).then((r) => r.json()),
}

const card = { border: '1px solid rgba(128,128,128,.35)', borderRadius: 10, padding: 14, background: 'rgba(128,128,128,.05)' }
const title = { fontSize: 15, fontWeight: 600 }
const sub = { fontSize: 11, opacity: .62 }
const label = { fontSize: 11, opacity: .7, marginBottom: 4 }
const input = { width: '100%', boxSizing: 'border-box', background: 'transparent', border: '1px solid rgba(128,128,128,.4)', borderRadius: 8, padding: '7px 9px', fontSize: 13, color: 'inherit' }
const btn = { border: '1px solid rgba(128,128,128,.4)', background: 'rgba(128,128,128,.12)', borderRadius: 8, padding: '7px 12px', fontSize: 13, color: 'inherit', cursor: 'pointer' }
const primary = { ...btn, background: '#2f81f7', borderColor: '#2f81f7', color: '#fff' }
const badge = (bg) => ({ display: 'inline-block', borderRadius: 999, padding: '2px 9px', fontSize: 11, fontWeight: 600, background: bg, color: '#fff' })

function Field({ label: l, value, onChange, type, placeholder }) {
  return React.createElement('div', { style: { marginTop: 10 } },
    React.createElement('div', { style: label }, l),
    React.createElement('input', { style: input, type: type || 'text', value: value, placeholder: placeholder || '', onChange: (e) => onChange(e.target.value) }),
  )
}

function Kv({ k, v }) {
  return React.createElement('div', null,
    React.createElement('div', { style: { fontSize: 11, opacity: .6 } }, k),
    React.createElement('div', { style: { fontSize: 12, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', wordBreak: 'break-all' } }, v === undefined || v === null || v === '' ? '—' : String(v)),
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
    api.status().then(setStatus).catch(() => {})
    api.config().then((c) => { if (c) setCfg({ hubUrl: c.hubUrl || '', apiKey: '', webhookSecret: '', pollMs: c.pollMs || 60000 }) }).catch(() => {})
  }
  React.useEffect(() => { refresh() }, [])

  const save = () => {
    setBusy(true); setMsg(null)
    const patch = { hubUrl: cfg.hubUrl, pollMs: Number(cfg.pollMs) || 0 }
    if (cfg.apiKey) patch.apiKey = cfg.apiKey
    if (cfg.webhookSecret) patch.webhookSecret = cfg.webhookSecret
    api.save(patch).then((r) => {
      setBusy(false)
      setMsg(r && r.ok
        ? { ok: true, text: 'Saved. Mode: ' + (r.echoMode ? 'dry-run (no API key)' : 'LIVE') + '. ' + (r.apiKeySet ? 'API key set.' : '') }
        : { ok: false, text: (r && r.error) || 'save failed' })
      refresh()
    }).catch((e) => { setBusy(false); setMsg({ ok: false, text: String((e && e.message) || e) }) })
  }

  const test = () => {
    setBusy(true); setMsg(null)
    api.test({ jid: testJid, text: testText }).then((r) => {
      setBusy(false)
      setMsg(r && r.ok
        ? { ok: true, text: r.message || 'sent' }
        : { ok: false, text: (r && r.error) || (r && r.message) || 'send failed' })
      refresh()
    }).catch((e) => { setBusy(false); setMsg({ ok: false, text: String((e && e.message) || e) }) })
  }

  const st = status || {}
  const badgeEl = st.echoMode
    ? React.createElement('span', { style: badge('#9a6700') }, 'DRY-RUN')
    : React.createElement('span', { style: badge('#1a7f37') }, 'LIVE')

  const msgEl = msg
    ? React.createElement('div', { style: { fontSize: 12, borderRadius: 8, padding: '8px 10px', background: msg.ok ? 'rgba(26,127,55,.16)' : 'rgba(207,34,46,.16)' } }, msg.text)
    : null

  return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 14, fontSize: 13, lineHeight: 1.5 } },
    React.createElement('div', { style: card },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
        React.createElement('div', null,
          React.createElement('div', { style: title }, 'WhatsApp Agent'),
          React.createElement('div', { style: sub }, 'DeepSeek Harness ⇄ whatsapp-hub bridge'),
        ),
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          badgeEl,
          React.createElement('button', { style: btn, onClick: refresh }, 'Refresh'),
        ),
      ),
    ),

    React.createElement('div', { style: card },
      React.createElement('div', { style: { ...title, fontSize: 13 } }, 'Status'),
      React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: '8px 14px', marginTop: 8 } },
        React.createElement(Kv, { k: 'Hub URL', v: st.hubUrl }),
        React.createElement(Kv, { k: 'Agent session', v: st.agentSessionId }),
        React.createElement(Kv, { k: 'Mode', v: st.echoMode ? 'dry-run' : 'live' }),
        React.createElement(Kv, { k: 'Seen messages', v: st.seenMessages }),
        React.createElement(Kv, { k: 'Tracked chats', v: st.chatsTracked }),
        React.createElement(Kv, { k: 'Outbox pending', v: st.outboxPending }),
        React.createElement(Kv, { k: 'API key', v: st.apiKeySet ? 'set' : 'none' }),
        React.createElement(Kv, { k: 'Webhook secret', v: st.webhookSecretSet ? 'set' : 'none' }),
      ),
    ),

    React.createElement('div', { style: card },
      React.createElement('div', { style: { ...title, fontSize: 13 } }, 'Configuration'),
      React.createElement('div', { style: { ...sub, marginTop: 2 } }, 'Leave a secret blank to keep the current value.'),
      React.createElement(Field, { label: 'Hub URL', value: cfg.hubUrl, onChange: (v) => setCfg({ ...cfg, hubUrl: v }) }),
      React.createElement(Field, { label: 'API key', type: 'password', placeholder: 'unchanged', value: cfg.apiKey, onChange: (v) => setCfg({ ...cfg, apiKey: v }) }),
      React.createElement(Field, { label: 'Webhook secret', type: 'password', placeholder: 'unchanged', value: cfg.webhookSecret, onChange: (v) => setCfg({ ...cfg, webhookSecret: v }) }),
      React.createElement(Field, { label: 'Reconcile poll (ms, 0 = off)', type: 'number', value: String(cfg.pollMs), onChange: (v) => setCfg({ ...cfg, pollMs: v }) }),
      React.createElement('div', { style: { marginTop: 12 } },
        React.createElement('button', { style: primary, disabled: busy, onClick: save }, busy ? 'Saving…' : 'Save config'),
      ),
    ),

    React.createElement('div', { style: card },
      React.createElement('div', { style: { ...title, fontSize: 13 } }, 'Send a test message'),
      React.createElement(Field, { label: 'Recipient (phone or JID)', value: testJid, onChange: setTestJid }),
      React.createElement(Field, { label: 'Text', value: testText, onChange: setTestText }),
      React.createElement('div', { style: { marginTop: 12 } },
        React.createElement('button', { style: btn, disabled: busy, onClick: test }, busy ? 'Sending…' : 'Send'),
      ),
    ),

    msgEl,
  )
}

export function apply(ctx) {
  const slots = ctx.get('slots')
  if (slots === undefined) return
  slots.inject('settings.section', () => slots.register(
    { name: 'settings.section', id: 'whatsapp', order: 30, label: 'WhatsApp Agent' },
    (props) => React.createElement(Panel, props),
  ))
}
