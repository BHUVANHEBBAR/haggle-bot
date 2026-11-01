/*!
 * HaggleBot embeddable widget. Add to any page:
 *   <script src="https://YOUR-HAGGLEBOT/embed.js" data-product="tote" async></script>
 * Optional: data-label="Haggle for a better price"  data-position="left"  data-color="#2563eb"
 * Listen for results:  window.addEventListener('haggle:deal', (e) => console.log(e.detail));
 * The host page can never set a price: the price lives on the HaggleBot server. Vanilla JS, no dependencies.
 */
(function () {
  'use strict';
  var me = document.currentScript || document.querySelector('script[src*="embed.js"]');
  if (!me || document.getElementById('haggle-embed-root')) return;
  var origin = new URL(me.src, location.href).origin;
  var product = me.getAttribute('data-product') || '';
  var label = me.getAttribute('data-label') || 'Haggle for a better price';
  var left = me.getAttribute('data-position') === 'left';
  var color = /^#[0-9a-f]{3,8}$/i.test(me.getAttribute('data-color') || '') ? me.getAttribute('data-color') : '#2563eb';

  var root = document.createElement('div');
  root.id = 'haggle-embed-root';
  root.style.cssText = 'position:fixed;bottom:16px;' + (left ? 'left' : 'right') + ':16px;z-index:2147483000;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif';

  var panel = document.createElement('div');
  panel.style.cssText = 'display:none;width:min(380px,calc(100vw - 32px));height:min(600px,calc(100vh - 96px));margin-bottom:10px;border-radius:16px;overflow:hidden;box-shadow:0 12px 40px rgba(11,31,58,.28);background:#fff;border:1px solid rgba(0,0,0,.08)';
  var frame = document.createElement('iframe');
  frame.title = 'HaggleBot negotiation';
  frame.setAttribute('allow', 'clipboard-write');
  frame.style.cssText = 'border:0;width:100%;height:100%';
  panel.appendChild(frame);

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.setAttribute('aria-expanded', 'false');
  btn.textContent = label;
  btn.style.cssText = 'display:block;margin-' + (left ? 'right' : 'left') + ':auto;min-height:44px;padding:10px 18px;border:0;border-radius:999px;background:' + color + ';color:#fff;font:700 15px system-ui,sans-serif;cursor:pointer;box-shadow:0 6px 20px rgba(11,31,58,.3)';

  btn.addEventListener('click', function () {
    var open = panel.style.display === 'none';
    if (open && !frame.src) frame.src = origin + '/app/embed' + (product ? '?product=' + encodeURIComponent(product) : '');
    panel.style.display = open ? 'block' : 'none';
    btn.setAttribute('aria-expanded', String(open));
    btn.textContent = open ? 'Close' : label;
  });

  // The widget reports results to the host page. Only messages from the HaggleBot origin and iframe are accepted.
  window.addEventListener('message', function (e) {
    if (e.origin !== origin || e.source !== frame.contentWindow || !e.data || e.data.source !== 'haggle') return;
    window.dispatchEvent(new CustomEvent('haggle:' + e.data.type, { detail: e.data.detail }));
  });

  root.appendChild(panel);
  root.appendChild(btn);
  document.body.appendChild(root);
})();
