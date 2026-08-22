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

    var CSS = `
.dswa-root{display:flex;flex-direction:column;gap:18px;font-family:var(--dsw-font-family);font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary)}
.dswa-root *,.dswa-root *::before,.dswa-root *::after{box-sizing:border-box}

/* staggered entrance */
@keyframes dswa-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
@keyframes dswa-pulse{0%{box-shadow:0 0 0 0 rgba(18,140,126,.45)}70%{box-shadow:0 0 0 6px rgba(18,140,126,0)}100%{box-shadow:0 0 0 0 rgba(18,140,126,0)}}
@keyframes dswa-breathe{0%,100%{opacity:.55}50%{opacity:1}}
@keyframes dswa-shimmer{0%{opacity:.45}50%{opacity:.9}100%{opacity:.45}}

/* header */
.dswa-header{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
.dswa-eyebrow{display:inline-flex;align-items:center;gap:6px;font-size:10px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary);margin-bottom:6px}
.dswa-eyebrow .dswa-eyebrow-tick{width:16px;height:1px;background:var(--dsw-alias-border-l2)}
.dswa-title{font-size:20px;font-weight:650;letter-spacing:-.02em;line-height:1.2}
.dswa-sub{font-size:12px;color:var(--dsw-alias-label-secondary);margin-top:3px}
.dswa-header-right{display:flex;flex-direction:column;align-items:flex-end;gap:8px;flex:none}

/* pill */
.dswa-pill{display:inline-flex;align-items:center;gap:6px;height:22px;padding:0 10px;border-radius:999px;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;border:1px solid transparent}
.dswa-pill-live{color:#0f7265;background:rgba(18,140,126,.14);border-color:rgba(18,140,126,.28)}
.dswa-pill-dry{color:#9a6700;background:rgba(154,103,0,.14);border-color:rgba(154,103,0,.3)}
.dswa-pill-dot{width:6px;height:6px;border-radius:50%;background:currentColor;animation:dswa-breathe 2.4s ease-in-out infinite}

/* icon button */
.dswa-iconbtn{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);cursor:pointer;transition:background var(--ds-transition-duration) var(--ds-ease-in-out),color var(--ds-transition-duration) var(--ds-ease-in-out),transform var(--ds-transition-duration-fast) var(--ds-ease-in-out)}
.dswa-iconbtn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dswa-iconbtn:active{transform:scale(.92)}
.dswa-iconbtn.is-spinning svg{animation:dswa-spin .7s linear infinite}
@keyframes dswa-spin{to{transform:rotate(360deg)}}

/* connection strip */
.dswa-connect{display:flex;align-items:center;gap:10px;padding:12px 14px;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-1)}
.dswa-dot{width:9px;height:9px;border-radius:50%;flex:none}
.dswa-dot.on{background:#128c7e;animation:dswa-pulse 2.2s ease-out infinite}
.dswa-dot.off{background:var(--dsw-alias-label-tertiary)}
.dswa-connect-main{min-width:0;flex:1}
.dswa-connect-line{font-size:12px;font-weight:600}
.dswa-connect-sub{font-size:11px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:var(--ds-font-family-code)}

/* metrics strip — no boxes, hairline-separated */
.dswa-metrics{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));border-top:1px solid var(--dsw-alias-border-l1);border-bottom:1px solid var(--dsw-alias-border-l1)}
.dswa-metric{padding:14px 6px 12px;border-left:1px solid var(--dsw-alias-border-l1)}
.dswa-metric:first-child{border-left:none;padding-left:2px}
.dswa-metric-val{font-family:var(--ds-font-family-code);font-size:20px;font-weight:600;letter-spacing:-.02em;line-height:1}
.dswa-metric-label{font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary);margin-top:7px}

/* card — double-bezel */
.dswa-card{--wa-i:0;animation:dswa-in .5s var(--ds-ease-in-out) both;animation-delay:calc(var(--wa-i) * 45ms)}
.dswa-shell{background:var(--dsw-alias-border-l1);border-radius:16px;padding:1px}
.dswa-core{background:var(--dsw-alias-bg-layer-1);border-radius:15px;padding:15px 16px}
.dswa-card-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:4px}
.dswa-card-title{font-size:12px;font-weight:650;letter-spacing:-.01em}
.dswa-card-note{font-size:11px;color:var(--dsw-alias-label-tertiary)}

/* key/value grid */
.dswa-kvgrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 16px;margin-top:12px}
.dswa-kv{min-width:0}
.dswa-kv-key{font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}
.dswa-kv-val{font-size:12px;font-family:var(--ds-font-family-code);color:var(--dsw-alias-label-primary);word-break:break-all;margin-top:3px}

/* form */
.dswa-field{margin-top:12px}
.dswa-field:first-child{margin-top:0}
.dswa-label{display:block;font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary);margin-bottom:5px}
.dswa-input{width:100%;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:8px 11px;font-size:13px;font-family:inherit;color:var(--dsw-alias-label-primary);transition:border-color var(--ds-transition-duration) var(--ds-ease-in-out),box-shadow var(--ds-transition-duration) var(--ds-ease-in-out)}
.dswa-input:focus{outline:none;border-color:#128c7e;box-shadow:0 0 0 3px rgba(18,140,126,.14)}
.dswa-input::placeholder{color:var(--dsw-alias-label-tertiary)}
.dswa-helper{font-size:11px;color:var(--dsw-alias-label-tertiary);margin-top:4px}

/* buttons */
.dswa-btn{display:inline-flex;align-items:center;gap:8px;height:34px;padding:0 16px;border-radius:999px;font-size:13px;font-weight:600;cursor:pointer;border:1px solid transparent;transition:transform var(--ds-transition-duration-fast) var(--ds-ease-in-out),background var(--ds-transition-duration) var(--ds-ease-in-out),border-color var(--ds-transition-duration) var(--ds-ease-in-out),color var(--ds-transition-duration) var(--ds-ease-in-out)}
.dswa-btn:active{transform:scale(.98)}
.dswa-btn:disabled{opacity:.55;cursor:not-allowed}
.dswa-btn-primary{background:#128c7e;color:#fff}
.dswa-btn-primary:hover:not(:disabled){background:#0f7265}
.dswa-btn-ghost{background:transparent;border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}
.dswa-btn-ghost:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dswa-btn-icon{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:rgba(255,255,255,.18);transition:transform var(--ds-transition-duration) var(--ds-ease-in-out)}
.dswa-btn:hover .dswa-btn-icon{transform:translateX(1.5px)}

/* list rows */
.dswa-list{margin-top:6px}
.dswa-row{display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid var(--dsw-alias-border-l1)}
.dswa-row:first-child{border-top:none}
.dswa-row-icon{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:8px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);flex:none}
.dswa-row-main{min-width:0;flex:1}
.dswa-row-line{font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:var(--ds-font-family-code)}
.dswa-row-sub{font-size:11px;color:var(--dsw-alias-label-tertiary);margin-top:1px}

/* status chips */
.dswa-chip{display:inline-flex;align-items:center;gap:4px;height:18px;padding:0 7px;border-radius:6px;font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;flex:none}
.dswa-chip-sent{color:#0f7265;background:rgba(18,140,126,.14)}
.dswa-chip-echo{color:#9a6700;background:rgba(154,103,0,.14)}
.dswa-chip-failed{color:#cf222e;background:rgba(207,34,46,.14)}
.dswa-chip-pending{color:#2f81f7;background:rgba(47,129,247,.14)}

/* memory: pending kind badge */
.dswa-kind{display:inline-flex;align-items:center;height:16px;padding:0 6px;border-radius:5px;font-size:9px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;flex:none}
.dswa-kind-commitment{color:#9a6700;background:rgba(154,103,0,.14)}
.dswa-kind-question{color:#2f81f7;background:rgba(47,129,247,.14)}

/* toast */
.dswa-toast{border-radius:12px;padding:11px 14px;font-size:12px;border:1px solid;animation:dswa-in .35s var(--ds-ease-in-out) both}
.dswa-toast-ok{color:#0f7265;background:rgba(18,140,126,.1);border-color:rgba(18,140,126,.28)}
.dswa-toast-err{color:#cf222e;background:rgba(207,34,46,.1);border-color:rgba(207,34,46,.3)}

/* empty + skeleton */
.dswa-empty{padding:18px 4px;font-size:12px;color:var(--dsw-alias-label-tertiary);text-align:center}
.dswa-skel{border-radius:10px;background:var(--dsw-alias-bg-skeleton);animation:dswa-shimmer 1.4s ease-in-out infinite}

/* mobile collapse */
@media (max-width:560px){
  .dswa-metrics{grid-template-columns:repeat(3,minmax(0,1fr))}
  .dswa-metric{border-left:none;padding-left:6px}
  .dswa-metric:first-child{padding-left:6px}
  .dswa-kvgrid{grid-template-columns:1fr}
  .dswa-header{flex-direction:column;align-items:stretch}
  .dswa-header-right{flex-direction:row;align-items:center;justify-content:space-between}
}
`

    var api = {
      status: function () { return fetch('/whatsapp/panel/status').then(function (r) { return r.json() }) },
      outbox: function () { return fetch('/whatsapp/panel/outbox').then(function (r) { return r.json() }) },
      config: function () { return fetch('/whatsapp/panel/config').then(function (r) { return r.json() }) },
      save: function (patch) {
        return fetch('/whatsapp/panel/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) }).then(function (r) { return r.json() })
      },
      test: function (patch) {
        return fetch('/whatsapp/panel/test-send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) }).then(function (r) { return r.json() })
      },
    }

    var ICON_PATHS = {
      bolt: 'M13 2 4.09 12.35a.5.5 0 0 0 .38.82H11l-1 8 8.91-10.35a.5.5 0 0 0-.38-.82H13l1-8Z',
      refresh: 'M20 11a8 8 0 1 0-2.34 5.66M20 4v7h-7',
      send: 'M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z',
      pulse: 'M3 12h4l2-7 4 14 2-7h6',
      plug: 'M9 7V2M15 7V2M6 7h12v4a6 6 0 0 1-12 0V7ZM12 17v5',
      check: 'M20 6 9 17l-5-5',
      clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 6v6l4 2',
      layers: 'M12 2 2 7l10 5 10-5-10-5ZM2 17l10 5 10-5M2 12l10 5 10-5',
      alert: 'M10.3 3.6 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0ZM12 9v4M12 17h.01',
    }

    function Icon(props) {
      var d = ICON_PATHS[props.name] || ICON_PATHS.bolt
      return React.createElement('svg', {
        width: props.size || 16, height: props.size || 16, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: props.strokeWidth || 1.5, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': true,
      }, React.createElement('path', { d: d }))
    }

    function Dot(props) {
      return React.createElement('span', { className: props.on ? 'dswa-dot on' : 'dswa-dot off' })
    }

    function Pill(props) {
      return React.createElement('span', { className: props.live ? 'dswa-pill dswa-pill-live' : 'dswa-pill dswa-pill-dry' },
        React.createElement('span', { className: 'dswa-pill-dot' }),
        props.live ? 'LIVE' : 'DRY-RUN',
      )
    }

    function Metric(props) {
      return React.createElement('div', { className: 'dswa-metric' },
        React.createElement('div', { className: 'dswa-metric-val' }, props.value),
        React.createElement('div', { className: 'dswa-metric-label' }, props.label),
      )
    }

    function Kv(props) {
      var v = props.v
      var text = v === undefined || v === null || v === '' ? '—' : String(v)
      return React.createElement('div', { className: 'dswa-kv' },
        React.createElement('div', { className: 'dswa-kv-key' }, props.k),
        React.createElement('div', { className: 'dswa-kv-val' }, text),
      )
    }

    function Field(props) {
      return React.createElement('div', { className: 'dswa-field' },
        React.createElement('label', { className: 'dswa-label' }, props.label),
        React.createElement('input', {
          className: 'dswa-input', type: props.type || 'text', value: props.value,
          placeholder: props.placeholder || '', onChange: function (e) { props.onChange(e.target.value) },
        }),
        props.helper ? React.createElement('div', { className: 'dswa-helper' }, props.helper) : null,
      )
    }

    function Chip(props) {
      return React.createElement('span', { className: 'dswa-chip dswa-chip-' + props.status }, props.status)
    }

    function Card(props) {
      return React.createElement('div', { className: 'dswa-card', style: { '--wa-i': props.index } },
        React.createElement('div', { className: 'dswa-shell' },
          React.createElement('div', { className: 'dswa-core' },
            React.createElement('div', { className: 'dswa-card-head' },
              React.createElement('div', { className: 'dswa-card-title' }, props.title),
              props.right || (props.note ? React.createElement('div', { className: 'dswa-card-note' }, props.note) : null),
            ),
            props.children,
          ),
        ),
      )
    }

    function Empty(props) {
      return React.createElement('div', { className: 'dswa-empty' }, props.children)
    }

    function Row(props) {
      return React.createElement('div', { className: 'dswa-row' },
        React.createElement('span', { className: 'dswa-row-icon' }, React.createElement(Icon, { name: props.icon, size: 14 })),
        React.createElement('div', { className: 'dswa-row-main' },
          React.createElement('div', { className: 'dswa-row-line' }, props.line),
          props.sub ? React.createElement('div', { className: 'dswa-row-sub' }, props.sub) : null,
        ),
        props.right || null,
      )
    }

    function timeAgo(ts) {
      if (!ts) return ''
      var s = Math.floor((Date.now() - ts) / 1000)
      if (s < 5) return 'just now'
      if (s < 60) return s + 's ago'
      var m = Math.floor(s / 60)
      if (m < 60) return m + 'm ago'
      var h = Math.floor(m / 60)
      if (h < 24) return h + 'h ago'
      return Math.floor(h / 24) + 'd ago'
    }

    var KIND_ICON = { text: 'send', reaction: 'bolt', read: 'check' }

    function Skeleton() {
      function block(h, w, mb) {
        return React.createElement('div', { className: 'dswa-skel', style: { height: h, width: w || '100%', marginBottom: mb || 0 } })
      }
      return React.createElement('div', { className: 'dswa-root', style: { gap: 18 } },
        React.createElement('div', null, block(22, 220, 6), block(12, 180)),
        React.createElement('div', { style: { display: 'flex', gap: 10 } },
          React.createElement('div', { style: { flex: 1 } }, block(48)),
          React.createElement('div', { style: { flex: 1 } }, block(48)),
          React.createElement('div', { style: { flex: 1 } }, block(48)),
        ),
        block(180), block(140), block(120),
      )
    }

    function Panel() {
      var statusState = React.useState(null); var status = statusState[0]; var setStatus = statusState[1]
      var outboxState = React.useState(null); var outbox = outboxState[0]; var setOutbox = outboxState[1]
      var cfgState = React.useState({ hubUrl: '', apiKey: '', webhookSecret: '', pollMs: 60000 }); var cfg = cfgState[0]; var setCfg = cfgState[1]
      var msgState = React.useState(null); var msg = msgState[0]; var setMsg = msgState[1]
      var busyState = React.useState(false); var busy = busyState[0]; var setBusy = busyState[1]
      var spinState = React.useState(false); var spinning = spinState[0]; var setSpinning = spinState[1]
      var jidState = React.useState('5511999999999@s.whatsapp.net'); var testJid = jidState[0]; var setTestJid = jidState[1]
      var textState = React.useState('Hello from the panel'); var testText = textState[0]; var setTestText = textState[1]

      function refresh(spin) {
        if (spin) { setSpinning(true); setTimeout(function () { setSpinning(false) }, 700) }
        api.status().then(setStatus).catch(function () { setStatus({ ok: false }) })
        api.outbox().then(function (r) { if (r && r.ok) setOutbox(r.outbox || []) }).catch(function () {})
        api.config().then(function (c) { if (c) setCfg({ hubUrl: c.hubUrl || '', apiKey: '', webhookSecret: '', pollMs: c.pollMs || 60000 }) }).catch(function () {})
      }
      React.useEffect(function () { refresh(false) }, [])

      function save() {
        setBusy(true); setMsg(null)
        var patch = { hubUrl: cfg.hubUrl, pollMs: Number(cfg.pollMs) || 0 }
        if (cfg.apiKey) patch.apiKey = cfg.apiKey
        if (cfg.webhookSecret) patch.webhookSecret = cfg.webhookSecret
        api.save(patch).then(function (r) {
          setBusy(false)
          setMsg(r && r.ok ? { ok: true, text: 'Saved. Mode: ' + (r.echoMode ? 'dry-run (no API key)' : 'LIVE') + '.' } : { ok: false, text: (r && r.error) || 'save failed' })
          refresh(false)
        }).catch(function (e) { setBusy(false); setMsg({ ok: false, text: String((e && e.message) || e) }) })
      }

      function test() {
        setBusy(true); setMsg(null)
        api.test({ jid: testJid, text: testText }).then(function (r) {
          setBusy(false)
          setMsg(r && r.ok ? { ok: true, text: r.message || 'sent' } : { ok: false, text: (r && r.error) || (r && r.message) || 'send failed' })
          refresh(false)
        }).catch(function (e) { setBusy(false); setMsg({ ok: false, text: String((e && e.message) || e) }) })
      }

      if (!status) return React.createElement('div', null, React.createElement(Skeleton, null))

      var st = status || {}
      var an = (st.analytics && st.analytics.totals) || {}
      var recent = outbox !== null ? outbox : (st.outbox || [])
      var pending = st.pending || []
      var lessons = st.lessons || []

      function fmt(n) { return (n === null || n === undefined) ? '—' : Number(n).toLocaleString('en-US') }

      var metrics = [
        { label: 'Received', value: fmt(an.received) },
        { label: 'Sent', value: fmt(an.sent) },
        { label: 'Chats', value: an.distinctChats != null ? fmt(an.distinctChats) : '—' },
        { label: 'Total', value: fmt(an.total) },
        { label: 'Media', value: fmt(an.media) },
      ]

      var toast = msg
        ? React.createElement('div', { className: msg.ok ? 'dswa-toast dswa-toast-ok' : 'dswa-toast dswa-toast-err' }, msg.text)
        : null

      var activityRows = recent.length
        ? recent.map(function (r) {
            return React.createElement(Row, {
              key: r.key || r.jid + r.createdAt,
              icon: KIND_ICON[r.kind] || 'pulse',
              line: r.jid || '—',
              sub: (r.status === 'failed' && r.lastError ? 'error: ' + r.lastError + ' · ' : '') + timeAgo(r.createdAt),
              right: React.createElement(Chip, { status: r.status }),
            })
          })
        : null

      var pendingRows = pending.length
        ? pending.slice(0, 6).map(function (p, i) {
            return React.createElement(Row, {
              key: i,
              icon: p.kind === 'commitment' ? 'clock' : 'bolt',
              line: p.what,
              sub: (p.jid && p.jid !== 'global' ? p.jid + (p.due ? ' · due ' + p.due : '') : (p.due ? 'due ' + p.due : '')),
              right: React.createElement('span', { className: 'dswa-kind dswa-kind-' + p.kind }, p.kind),
            })
          })
        : null

      var lessonRows = lessons.length
        ? lessons.slice().reverse().map(function (l, i) {
            return React.createElement(Row, { key: i, icon: 'check', line: l.lesson })
          })
        : null

      var arrow = React.createElement('span', { className: 'dswa-btn-icon' },
        React.createElement(Icon, { name: 'send', size: 10 }))

      return React.createElement('div', { className: 'dswa-root' },
        React.createElement('div', { className: 'dswa-header' },
          React.createElement('div', null,
            React.createElement('div', { className: 'dswa-eyebrow' },
              React.createElement('span', { className: 'dswa-eyebrow-tick' }), 'WhatsApp Bridge'),
            React.createElement('div', { className: 'dswa-title' }, 'WhatsApp Agent'),
            React.createElement('div', { className: 'dswa-sub' }, 'DeepSeek Harness ⇄ whatsapp-hub'),
          ),
          React.createElement('div', { className: 'dswa-header-right' },
            React.createElement(Pill, { live: !st.echoMode }),
            React.createElement('button', {
              className: spinning ? 'dswa-iconbtn is-spinning' : 'dswa-iconbtn',
              onClick: function () { refresh(true) }, 'aria-label': 'Refresh',
            }, React.createElement(Icon, { name: 'refresh', size: 15 })),
          ),
        ),
        React.createElement('div', { className: 'dswa-connect' },
          React.createElement(Dot, { on: st.connected }),
          React.createElement('div', { className: 'dswa-connect-main' },
            React.createElement('div', { className: 'dswa-connect-line' },
              st.connected ? 'Connected' : (st.echoMode ? 'Dry-run (no live hub)' : 'Not connected')),
            React.createElement('div', { className: 'dswa-connect-sub' }, st.hubUrl || 'http://127.0.0.1:3100'),
          ),
          React.createElement('div', { className: 'dswa-connect-sub' }, 'agent ' + (st.agent || '—')),
        ),
        React.createElement('div', { className: 'dswa-metrics' },
          metrics.map(function (m) { return React.createElement(Metric, { key: m.label, label: m.label, value: m.value }) }),
        ),
        React.createElement(Card, { title: 'Configuration', note: 'Secrets left blank keep their current value.', index: 2 },
          React.createElement(Field, { label: 'Hub URL', value: cfg.hubUrl, placeholder: 'https://zapzaphub.rrayes.com.br', onChange: function (v) { setCfg(Object.assign({}, cfg, { hubUrl: v })) } }),
          React.createElement(Field, { label: 'API key', type: 'password', placeholder: 'unchanged', value: cfg.apiKey, onChange: function (v) { setCfg(Object.assign({}, cfg, { apiKey: v })) } }),
          React.createElement(Field, { label: 'Webhook secret', type: 'password', placeholder: 'unchanged', value: cfg.webhookSecret, onChange: function (v) { setCfg(Object.assign({}, cfg, { webhookSecret: v })) } }),
          React.createElement(Field, { label: 'Reconcile poll (ms, 0 = off)', type: 'number', value: String(cfg.pollMs), helper: 'Reconciliation polling interval for at-least-once inbound delivery.', onChange: function (v) { setCfg(Object.assign({}, cfg, { pollMs: v })) } }),
          React.createElement('div', { style: { marginTop: 14 } },
            React.createElement('button', { className: 'dswa-btn dswa-btn-primary', disabled: busy, onClick: save },
              busy ? 'Saving…' : 'Save config', arrow),
          ),
        ),
        React.createElement(Card, { title: 'Test send', note: 'Verifies the outbox and the resolved JID.', index: 3 },
          React.createElement(Field, { label: 'Recipient (phone or JID)', value: testJid, onChange: setTestJid }),
          React.createElement(Field, { label: 'Text', value: testText, onChange: setTestText }),
          React.createElement('div', { style: { marginTop: 14 } },
            React.createElement('button', { className: 'dswa-btn dswa-btn-ghost', disabled: busy, onClick: test },
              busy ? 'Sending…' : 'Send message'),
          ),
        ),
        React.createElement(Card, { title: 'Activity', note: recent.length ? recent.length + ' recent send(s)' : 'no sends yet', index: 4 },
          activityRows
            ? React.createElement('div', { className: 'dswa-list' }, activityRows)
            : React.createElement(Empty, null, 'No outbound activity yet — run a test send.'),
        ),
        React.createElement(Card, { title: 'Memory', note: 'durable agent state', index: 5 },
          pendingRows
            ? React.createElement('div', { className: 'dswa-list' }, pendingRows)
            : React.createElement(Empty, null, 'Nothing pending — no open commitments or questions.'),
          lessonRows && lessonRows.length
            ? React.createElement(React.Fragment, null,
                React.createElement('div', { className: 'dswa-card-note', style: { margin: '12px 0 2px', fontWeight: 600 } }, 'Recent lessons'),
                React.createElement('div', { className: 'dswa-list' }, lessonRows))
            : null,
        ),
        toast,
      )
    }

    function apply(ctx) {
      var slots = ctx.get('slots')
      if (slots === undefined) return
      if (typeof document !== 'undefined') {
        var id = '@rafa/dsh-whatsapp-agent/panel.css'
        if (!document.querySelector('style[data-plugin-css="' + id + '"]')) {
          var tag = document.createElement('style')
          tag.setAttribute('data-plugin-css', id)
          tag.textContent = CSS
          document.head.appendChild(tag)
        }
      }
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
