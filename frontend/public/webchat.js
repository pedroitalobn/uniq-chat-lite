(function () {
  "use strict";

  var _token = null;
  var _open = false;
  var _container = null;
  var _iframe = null;
  var _btn = null;
  var _primaryColor = "#00d46a";
  var _appOrigin = "";

  try {
    var src = (document.currentScript || {}).src || "";
    if (src) _appOrigin = new URL(src).origin;
  } catch (e) {}

  function createWidget() {
    if (_container) return;

    _container = document.createElement("div");
    _container.id = "uniq-webchat-widget";
    _container.style.cssText =
      "position:fixed;bottom:20px;right:20px;z-index:2147483647;" +
      "display:flex;flex-direction:column;align-items:flex-end;gap:12px;";

    _iframe = document.createElement("iframe");
    _iframe.style.cssText =
      "display:none;width:380px;height:580px;border:none;border-radius:16px;" +
      "box-shadow:0 8px 40px rgba(0,0,0,0.18);background:#fff;" +
      "opacity:0;transform:translateY(12px);transition:opacity 0.2s,transform 0.2s;";
    _iframe.allow = "microphone";
    _iframe.title = "Uniq Chat";

    _btn = document.createElement("button");
    _btn.style.cssText =
      "width:56px;height:56px;border-radius:50%;border:none;" +
      "background:" + _primaryColor + ";color:#fff;cursor:pointer;" +
      "display:flex;align-items:center;justify-content:center;flex-shrink:0;" +
      "box-shadow:0 4px 20px " + _primaryColor + "60;" +
      "transition:transform 0.2s,box-shadow 0.2s;";
    _btn.innerHTML = svgChat();
    _btn.setAttribute("aria-label", "Abrir chat");
    _btn.addEventListener("mouseenter", function () { _btn.style.transform = "scale(1.08)"; });
    _btn.addEventListener("mouseleave", function () { _btn.style.transform = "scale(1)"; });
    _btn.addEventListener("click", toggle);

    _container.appendChild(_iframe);
    _container.appendChild(_btn);
    document.body.appendChild(_container);
  }

  function toggle() {
    _open = !_open;
    if (_open) {
      if (!_iframe.src) _iframe.src = _appOrigin + "/embed/chat/" + _token;
      _iframe.style.display = "block";
      setTimeout(function () {
        _iframe.style.opacity = "1";
        _iframe.style.transform = "translateY(0)";
      }, 10);
      _btn.innerHTML = svgClose();
      _btn.setAttribute("aria-label", "Fechar chat");
    } else {
      _iframe.style.opacity = "0";
      _iframe.style.transform = "translateY(12px)";
      setTimeout(function () { _iframe.style.display = "none"; }, 200);
      _btn.innerHTML = svgChat();
      _btn.setAttribute("aria-label", "Abrir chat");
    }
  }

  function applyColor(color) {
    if (!color || !_btn) return;
    _primaryColor = color;
    _btn.style.background = color;
    _btn.style.boxShadow = "0 4px 20px " + color + "60";
  }

  function svgChat() {
    return '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  }

  function svgClose() {
    return '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  }

  window.UniqWebChat = {
    init: function (opts) {
      if (!opts || !opts.token) return;
      _token = opts.token;

      var apiUrl = (opts.apiUrl || "").replace(/\/$/, "");
      fetch(apiUrl + _token)
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (cfg) { if (cfg && cfg.primary_color) applyColor(cfg.primary_color); })
        .catch(function () {});

      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", createWidget);
      } else {
        createWidget();
      }
    },
  };
})();
