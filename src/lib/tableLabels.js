// On phones tables are shown as stacked cards (see styles.css). Each cell needs its column name for that,
// so copy every header cell's text onto the cells below it as a data-label. Runs on every DOM change.
function label(table) {
  const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim())
  if (!heads.length) return
  for (const tr of table.querySelectorAll('tbody tr')) {
    ;[...tr.children].forEach((td, i) => {
      if (td.tagName === 'TD' && td.getAttribute('data-label') !== (heads[i] ?? '')) td.setAttribute('data-label', heads[i] ?? '')
    })
  }
}

export function installTableLabels() {
  let timer
  const run = () => { clearTimeout(timer); timer = setTimeout(() => document.querySelectorAll('table').forEach(label), 20) }
  // childList only: setting an attribute does not re-trigger the observer
  new MutationObserver(run).observe(document.body, { childList: true, subtree: true })
  run()
}
