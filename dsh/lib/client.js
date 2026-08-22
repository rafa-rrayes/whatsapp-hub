// Pre-built client bundle for @rafa/dsh-whatsapp-agent.
//
// This is the exact wire format the DSH web shell expects: a CJS factory handed
// to `window.__ModuleLoader__.load({ id, factory })`, with `react` resolved
// through the injected require (the loader module table). It is hand-maintained
// to mirror `../src/client.js` (plain-ESM reference source) — no esbuild needed.
//
// The id must equal the package.json `name` exactly (the loader registers by
// that id).

window.__ModuleLoader__.load({
  id: '@rafa/dsh-whatsapp-agent',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')

    var api = {
      status: function () { return fetch('/whatsapp/panel/status').then(function (r) { return r.json() }) },
      config: function () { return fetch('/whatsapp/panel/config').then(function (r) { return r.json() }) },
      save: function (patch) {
        return fetch('/whatsapp/panel/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) }).then(function (r) { return r.json() })
      },
      test: function (patch) {
        return fetch('/whatsapp/panel/test-send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) }).then(function (r) { return r.json() })
      },
    }

    var card = { border: '1px solid rgba(128,128,128,.35)', borderRadius: 10, padding: 14, background: 'rgba(128,128,128,.05)' }
    var title = { fontSize: 15, fontWeight: 600 }
    var sub = { fontSize: 11, opacity: 0.62 }
    var label = { fontSize: 11, opacity: 0.7, marginBottom: 4 }
    var input = { width: '100%', boxSizing: 'border-box', background: 'transparent', border: '1px solid rgba(128,128,128,.4)', borderRadius: 8, padding: '7px 9px', fontSize: 13, color: 'inherit' }
    var btn = { border: '1px solid rgba(128,128,128,.4)', background: 'rgba(128,128,128,.12)', borderRadius: 8, padding: '7px 12px', fontSize: 13, color: 'inherit', cursor: 'pointer' }
    var primary = Object.assign({}, btn, { background: '#2f81f7', borderColor: '#2f81f7', color: '#fff' })
    function badge(bg) { return { display: 'inline-block', borderRadius: 999, padding: '2px 9px', fontSize: 11, fontWeight: 600, background: bg, color: '#fff' } }

    function Field(props) {
      return React.createElement('div', { style: { marginTop: 10 } },
        React.createElement('div', { style: label }, props.label),
        React.createElement('input', { style: input, type: props.type || 'text', value: props.value, placeholder: props.placeholder || '', onChange: function (e) { props.onChange(e.target.value) } }),
      )
    }

    function Kv(props) {
      var v = props.v
      var text = v === undefined || v === null || v === '' ? '—' : String(v)
      return React.createElement('div', null,
        React.createElement('div', { style: { fontSize: 11, opacity: 0.6 } }, props.k),
        React.createElement('div', { style: { fontSize: 12, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', wordBreak: 'break-all' } }, text),
      )
    }

    function Panel() {
      var statusState = React.useState(null); var status = statusState[0]; var setStatus = statusState[1]
      var cfgState = React.useState({ hubUrl: '', apiKey: '', webhookSecret: '', pollMs: 60000 }); var cfg = cfgState[0]; var setCfg = cfgState[1]
      var msgState = React.useState(null); var msg = msgState[0]; var setMsg = msgState[1]
      var busyState = React.useState(false); var busy = busyState[0]; var setBusy = busyState[1]
      var jidState = React.useState('5511999999999@s.whatsapp.net'); var testJid = jidState[0]; var setTestJid = jidState[1]
      var textState = React.useState('Hello from the panel'); var testText = textState[0]; var setTestText = textState[1]

      function refresh() {
        api.status().then(setStatus).catch(function () {})
        api.config().then(function (c) { if (c) setCfg({ hubUrl: c.hubUrl || '', apiKey: '', webhookSecret: '', pollMs: c.pollMs || 60000 }) }).catch(function () {})
      }
      React.useEffect(function () { refresh() }, [])

      function save() {
        setBusy(true); setMsg(null)
        var patch = { hubUrl: cfg.hubUrl, pollMs: Number(cfg.pollMs) || 0 }
        if (cfg.apiKey) patch.apiKey = cfg.apiKey
        if (cfg.webhookSecret) patch.webhookSecret = cfg.webhookSecret
        api.save(patch).then(function (r) {
          setBusy(false)
          setMsg(r && r.ok
            ? { ok: true, text: 'Saved. Mode: ' + (r.echoMode ? 'dry-run (no API key)' : 'LIVE') + '. ' + (r.apiKeySet ? 'API key set.' : '') }
            : { ok: false, text: (r && r.error) || 'save failed' })
          refresh()
        }).catch(function (e) { setBusy(false); setMsg({ ok: false, text: String((e && e.message) || e) }) })
      }

      function test() {
        setBusy(true); setMsg(null)
        api.test({ jid: testJid, text: testText }).then(function (r) {
          setBusy(false)
          setMsg(r && r.ok ? { ok: true, text: r.message || 'sent' } : { ok: false, text: (r && r.error) || (r && r.message) || 'send failed' })
          refresh()
        }).catch(function (e) { setBusy(false); setMsg({ ok: false, text: String((e && e.message) || e) }) })
      }

      var st = status || {}
      var badgeEl = st.echoMode
        ? React.createElement('span', { style: badge('#9a6700') }, 'DRY-RUN')
        : React.createElement('span', { style: badge('#1a7f37') }, 'LIVE')

      var msgEl = msg
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
          React.createElement('div', { style: Object.assign({}, title, { fontSize: 13 }) }, 'Status'),
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
          React.createElement('div', { style: Object.assign({}, title, { fontSize: 13 }) }, 'Configuration'),
          React.createElement('div', { style: Object.assign({}, sub, { marginTop: 2 }) }, 'Leave a secret blank to keep the current value.'),
          React.createElement(Field, { label: 'Hub URL', value: cfg.hubUrl, onChange: function (v) { setCfg(Object.assign({}, cfg, { hubUrl: v })) } }),
          React.createElement(Field, { label: 'API key', type: 'password', placeholder: 'unchanged', value: cfg.apiKey, onChange: function (v) { setCfg(Object.assign({}, cfg, { apiKey: v })) } }),
          React.createElement(Field, { label: 'Webhook secret', type: 'password', placeholder: 'unchanged', value: cfg.webhookSecret, onChange: function (v) { setCfg(Object.assign({}, cfg, { webhookSecret: v })) } }),
          React.createElement(Field, { label: 'Reconcile poll (ms, 0 = off)', type: 'number', value: String(cfg.pollMs), onChange: function (v) { setCfg(Object.assign({}, cfg, { pollMs: v })) } }),
          React.createElement('div', { style: { marginTop: 12 } },
            React.createElement('button', { style: primary, disabled: busy, onClick: save }, busy ? 'Saving…' : 'Save config'),
          ),
        ),
        React.createElement('div', { style: card },
          React.createElement('div', { style: Object.assign({}, title, { fontSize: 13 }) }, 'Send a test message'),
          React.createElement(Field, { label: 'Recipient (phone or JID)', value: testJid, onChange: setTestJid }),
          React.createElement(Field, { label: 'Text', value: testText, onChange: setTestText }),
          React.createElement('div', { style: { marginTop: 12 } },
            React.createElement('button', { style: btn, disabled: busy, onClick: test }, busy ? 'Sending…' : 'Send'),
          ),
        ),
        msgEl,
      )
    }

    function apply(ctx) {
      var slots = ctx.get('slots')
      if (slots === undefined) return
      slots.inject('settings.section', function () {
        return slots.register(
          { name: 'settings.section', id: 'whatsapp', order: 30, label: 'WhatsApp Agent' },
          function (props) { return React.createElement(Panel, props) },
        )
      })
    }

    exports.apply = apply
    exports.name = 'whatsapp-agent-client'
    return module.exports
  },
})
