/**
 * The Sandbox — what a person or an agent needs to build against this.
 *
 * The page is mostly prose and examples, which need no script. This file exists
 * for the one thing prose cannot do honestly: say whether the API is actually
 * answering.
 *
 * That matters more than it sounds. A documentation page that describes an
 * endpoint is making a claim about something outside itself, and it will go on
 * making it after the endpoint stops answering — which is how a project ends up
 * with a page confidently documenting a 502. This project deleted a whole
 * section for a milder version of the same fault, and the entry is in
 * docs/decisions.md: a submission should meet what exists, not a tour of what
 * does not.
 *
 * So the page asks. It shows what it got back, verbatim, including a failure,
 * and it never says "live" on its own authority.
 */

// ─── Where the API is ──────────────────────────────────────────────────────
//
// A constant with an override rather than a build flag, because the first
// deploy lands on <name>.<subdomain>.workers.dev and the custom domain comes
// later. `?api=` lets a deployment be checked before it is written into
// anything, and it is also how the same page will be pointed at mainnet.
const API_DEFAULT = 'https://api.nextkey.li'

const params = new URLSearchParams(location.search)
const API = (params.get('api') || API_DEFAULT).replace(/\/+$/, '')

// The API mirrors the site's own rule: the network is a path prefix. A page
// served at /demo/sandbox therefore asks /demo/v1, and the mainnet page will
// ask /v1 without a line of this file changing.
const PREFIX = /(^|\/)demo(\/|$)/.test(location.pathname) ? '/demo/v1' : '/v1'
const BASE = API + PREFIX

const t = (key, en) => {
  const lang = document.documentElement.dataset.i18nLang
  const dict = lang && lang !== 'en' ? window.I18N?.[lang] : null
  return dict?.[key] ?? en
}

const $ = (id) => document.getElementById(id)
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))

const REQUIRED_ELEMENTS = [
  'api-base', 'api-state', 'api-health', 'try-name', 'try-go', 'try-out', 'try-url',
]
{
  const missing = REQUIRED_ELEMENTS.filter((id) => !document.getElementById(id))
  if (missing.length) {
    throw new Error(`sandbox.html is out of step with sandbox.js — missing: ${missing.join(', ')}`)
  }
}

const say = (el, kind, html) => {
  el.className = `out ${kind}`
  el.innerHTML = html
  el.hidden = false
}

/** Every example on the page carries the address actually in use. */
for (const el of document.querySelectorAll('[data-api-base]')) el.textContent = BASE

/**
 * Ask, rather than assert.
 *
 * Three outcomes and three different sentences. "Not deployed yet" and "the
 * node behind it failed" are not the same news for somebody about to build
 * against this, and a single red box saying "unavailable" would tell them
 * neither.
 */
async function probe () {
  const url = `${BASE}/health`
  $('api-base').textContent = BASE
  say($('api-health'), 'busy', `<p>${t('sb.asking', 'Asking the API whether it is there…')} <span class="mono">${esc(url)}</span></p>`)
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' } })
    const body = await res.json().catch(() => null)

    if (res.status === 501 && body?.error?.code === 'network_not_live') {
      return say($('api-health'), '', `
        <p>${t('sb.notlive', 'The API is answering, and says this network is not live yet.')}</p>
        <pre class="mono">${esc(JSON.stringify(body, null, 2))}</pre>`)
    }
    if (!res.ok || !body?.ok) {
      return say($('api-health'), 'bad', `
        <p>${t('sb.badanswer', 'The API answered, but not with a healthy one.')} <span class="mono">HTTP ${res.status}</span></p>
        <pre class="mono">${esc(JSON.stringify(body, null, 2))}</pre>`)
    }
    say($('api-health'), 'ok', `
      <p>${t('sb.live', 'Answering, right now, from this browser.')}</p>
      <pre class="mono">${esc(JSON.stringify(body, null, 2))}</pre>
      <p class="note">${t('sb.livenote', 'Two of those fields are the ones worth reading: writes is false because there is no route that writes, and logs is false because there is no storage attached for a name to be written into.')}</p>`)
  } catch (e) {
    // Reached from the visitor's own browser, so this is also the CORS check
    // and the DNS check. Naming the three likely causes beats "failed to
    // fetch", which tells a reader nothing about which of them it was.
    say($('api-health'), 'bad', `
      <p>${t('sb.unreachable', 'This browser could not reach the API at all.')}</p>
      <p class="note">${t('sb.unreachablenote', 'Either it is not deployed at this address yet, the address is wrong, or something between here and it refused the request. Nothing on the rest of this page depends on it: the records it reads are public on chain, and the pages and the command line read them directly.')}</p>
      <pre class="mono">${esc(String(e?.message ?? e)).slice(0, 200)}</pre>`)
  }
}

// ─── Try it ────────────────────────────────────────────────────────────────
//
// The same request the documentation describes, issued from the reader's own
// browser, with the URL shown before it is sent. A "try it" box that hides the
// request it makes is a demonstration of itself rather than of the API.

const showUrl = () => {
  const name = $('try-name').value.trim().toLowerCase()
  $('try-url').textContent = `${BASE}/name/${name || '<name>'}`
}

$('try-name').addEventListener('input', showUrl)

$('try-go').addEventListener('click', async () => {
  const name = $('try-name').value.trim().toLowerCase()
  if (!name) {
    return say($('try-out'), 'bad', `<p>${t('sb.noname', 'A name first — for example anna.nextkey.eth.')}</p>`)
  }
  const url = `${BASE}/name/${encodeURIComponent(name)}`
  say($('try-out'), 'busy', `<p>${t('sb.asking2', 'Asking…')} <span class="mono">${esc(url)}</span></p>`)
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' } })
    const body = await res.json().catch(() => null)
    // A refusal is shown as fully as an answer. The 404 for a name that
    // publishes no key is not an error in the reader's usage — it is the
    // answer, and it is the one they will meet most often.
    say($('try-out'), res.ok ? 'ok' : '', `
      <p><span class="mono">HTTP ${res.status}</span></p>
      <pre class="mono">${esc(JSON.stringify(body, null, 2))}</pre>`)
  } catch (e) {
    say($('try-out'), 'bad', `
      <p>${t('sb.unreachable', 'This browser could not reach the API at all.')}</p>
      <pre class="mono">${esc(String(e?.message ?? e)).slice(0, 200)}</pre>`)
  }
})

showUrl()
probe()

// What a reader-agent can pick up without parsing the page.
window.NEXTKEY_SANDBOX = { api: API, base: BASE, openapi: `${BASE}/openapi.json` }
