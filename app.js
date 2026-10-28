/* Badminton sign-ups app.
   No need to edit this file. Settings live in config.js.

   How it works: the sign-up page itself still lives in your Google Sheet's
   Apps Script (the Index file). This app fetches that page, shows it full
   screen, and passes its requests to the sheet. So any change you make to
   Index in Apps Script shows up in the app too, with no change here. */

(function () {
  'use strict';

  var C = window.BADMINTON_CONFIG || {};
  // Saved copies belong to one sheet link, so a different link never shows another version's page.
  var SHEET_TAG = String(C.appsScriptUrl || '').replace(/^https?:\/\//, '').slice(-40);
  var PAGE_KEY = 'bm_page_v2|' + SHEET_TAG;
  var STATE_KEY = 'bm_state_v1|' + SHEET_TAG;
  var FRESH_MS = 30000; // sessions saved this recently count as up to date

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function abs(path) { return new URL(path, location.href).href; }
  function meta(name, fallback) {
    var m = document.querySelector('meta[name="' + name + '"]');
    return (m && m.getAttribute('content')) || fallback;
  }
  // The name and colour come from index.html, so the test and live apps can differ
  var APP_NAME = meta('apple-mobile-web-app-title', 'Badminton');
  var THEME = meta('theme-color', '#1E6B4F');

  // ---------- Saved sessions, so the page can show something straight away ----------
  function saveState(state) {
    if (!state || typeof state !== 'object') return;
    try { lsSet(STATE_KEY, JSON.stringify({ at: Date.now(), state: state })); } catch (e) {}
  }
  function savedState() {
    try {
      var s = JSON.parse(lsGet(STATE_KEY) || 'null');
      if (!s || !s.state) return null;
      var st = JSON.parse(JSON.stringify(s.state));
      // Move the page's clock on to now, so sessions that have since finished show as finished
      if (typeof st.now === 'number') st.now += Date.now() - s.at;
      return { age: Date.now() - s.at, state: st };
    } catch (e) { return null; }
  }
  // Drop the saved copies left by the first version of the app
  lsSet('bm_page_v1', null);

  // ---------- Talking to the sheet ----------
  function call(fn, args) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 45000) : null;
    return fetch(C.appsScriptUrl, {
      method: 'POST',
      redirect: 'follow',
      // text/plain keeps this a "simple" request, which Apps Script accepts from another site
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ fn: fn, args: args || [] }),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) {
      if (!r.ok) throw new Error('The sheet replied with an error (' + r.status + ').');
      return r.json();
    }).then(function (j) {
      if (timer) clearTimeout(timer);
      if (!j || !j.ok) throw new Error((j && j.error) || 'The sheet sent back something unexpected.');
      return j.result;
    }, function (err) {
      if (timer) clearTimeout(timer);
      throw err;
    });
  }

  var isRuntime = !!document.querySelector('meta[name="bm-runtime"]');
  if (isRuntime) runtime(); else boot();

  // =====================================================================
  // BOOT: runs in the bare app shell. Gets the page, then swaps it in.
  // =====================================================================
  function boot() {
    function splashMsg(html) {
      var el = document.getElementById('splash-msg');
      if (el) el.innerHTML = html;
    }
    function start() {
      if (!C.appsScriptUrl) {
        splashMsg('Almost there. Add your Apps Script link to <b>config.js</b>.');
        return;
      }
      var cached = lsGet(PAGE_KEY);
      if (cached) { show(cached); return; }
      fetchPage();
    }
    function fetchPage() {
      splashMsg('Loading sign-ups…');
      // One trip for the page and the sessions together.
      // Falls back to the page alone if the sheet's App.gs is the older version.
      call('boot').then(function (res) {
        if (res && res.state) saveState(res.state);
        return res && res.page;
      }, function (err) {
        if (/Unknown request/.test(String(err && err.message))) return call('page');
        throw err;
      }).then(function (html) {
        if (!html || typeof html !== 'string') throw new Error('No page came back.');
        lsSet(PAGE_KEY, html);
        show(html);
      }).catch(function () {
        splashMsg('Couldn’t reach the sign-up sheet. Check your connection.<br><button id="retry" type="button">Try again</button>');
        var b = document.getElementById('retry');
        if (b) b.onclick = fetchPage;
      });
    }
    // document.open only works once this shell has finished loading
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(start, 0); });
    else setTimeout(start, 0);
  }

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function escAttr(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

  function headExtras() {
    return [
      '<meta name="bm-runtime" content="1">',
      '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
      '<meta name="theme-color" content="' + escAttr(THEME) + '">',
      '<meta name="apple-mobile-web-app-capable" content="yes">',
      '<meta name="mobile-web-app-capable" content="yes">',
      '<meta name="apple-mobile-web-app-title" content="' + escAttr(APP_NAME) + '">',
      '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
      '<link rel="manifest" href="' + abs('manifest.webmanifest') + '">',
      '<link rel="apple-touch-icon" href="' + abs('apple-touch-icon.png') + '">',
      '<link rel="icon" type="image/png" href="' + abs('icon-192.png') + '">',
      '<link rel="stylesheet" href="' + abs('app.css') + '">',
      '<script src="' + abs('config.js') + '"><\/script>',
      '<script src="' + abs('app.js') + '"><\/script>'
    ].join('');
  }

  function show(html) {
    var extra = headExtras();
    var out;
    if (/<head[^>]*>/i.test(html)) out = html.replace(/<head[^>]*>/i, function (m) { return m + extra; });
    else if (/<html[^>]*>/i.test(html)) out = html.replace(/<html[^>]*>/i, function (m) { return m + '<head>' + extra + '</head>'; });
    else out = '<!DOCTYPE html><html><head>' + extra + '</head><body>' + html + '</body></html>';
    document.open();
    document.write(out);
    document.close();
  }

  // =====================================================================
  // RUNTIME: runs inside the swapped-in page, before the page's own code.
  // =====================================================================
  function runtime() {
    installGoogleShim();
    window.addEventListener('DOMContentLoaded', function () {
      fixViewport();
      refreshCachedPage();
      setupInstallAndNotifications();
    });
  }

  // The page talks to the sheet with google.script.run, which only exists
  // on Google's own site. This stands in for it and sends the same calls
  // to the sheet over the web instead.
  function installGoogleShim() {
    var firstLoad = true;

    // Calls without an admin PIN return the same public view for everyone,
    // so those are the only ones saved on the phone.
    function isPublic(fn, args) {
      if (fn === 'apiGetState') return !args[0];
      if (fn === 'apiAction') return !(args[0] && args[0].pin);
      return false;
    }

    function send(fn, args, ok, fail, userObj) {
      // Opening the app: show the saved sessions straight away, then the latest ones.
      if (fn === 'apiGetState' && firstLoad && isPublic(fn, args)) {
        firstLoad = false;
        var saved = savedState();
        if (saved) {
          setTimeout(function () { if (ok) ok(saved.state, userObj); }, 0);
          if (saved.age < FRESH_MS) return; // just fetched with the page, already up to date
          syncPill(true);
          call(fn, args).then(function (res) {
            syncPill(false);
            saveState(res);
            if (ok) ok(res, userObj);
          }, function (err) {
            syncPill(false);
            if (fail) fail(err, userObj);
          });
          return;
        }
      }
      if (fn === 'apiGetState') firstLoad = false;
      call(fn, args).then(function (res) {
        if (isPublic(fn, args)) saveState(fn === 'apiAction' ? res && res.state : res);
        if (ok) ok(res, userObj);
      }, function (err) { if (fail) fail(err, userObj); });
    }

    function runner(ok, fail, userObj) {
      return new Proxy({}, {
        get: function (_, prop) {
          if (prop === 'withSuccessHandler') return function (f) { return runner(f, fail, userObj); };
          if (prop === 'withFailureHandler') return function (f) { return runner(ok, f, userObj); };
          if (prop === 'withUserObject') return function (o) { return runner(ok, fail, o); };
          if (typeof prop !== 'string') return undefined;
          return function () {
            send(prop, Array.prototype.slice.call(arguments), ok, fail, userObj);
          };
        }
      });
    }
    function params() {
      var p = {}, ps = {};
      new URLSearchParams(location.search).forEach(function (v, k) {
        if (!(k in p)) p[k] = v;
        (ps[k] = ps[k] || []).push(v);
      });
      return { parameter: p, parameters: ps, hash: location.hash.replace(/^#/, '') };
    }
    window.google = window.google || {};
    window.google.script = {
      run: runner(null, null, undefined),
      url: { getLocation: function (cb) { cb(params()); } },
      host: { close: function () {}, setHeight: function () {}, setWidth: function () {}, editor: { focus: function () {} } },
      history: { push: function () {}, replace: function () {}, setChangeHandler: function () {} }
    };
  }

  // Keep one viewport tag, ours, so the page fits around the notch and home bar.
  function fixViewport() {
    var tags = document.querySelectorAll('meta[name="viewport"]');
    for (var i = 1; i < tags.length; i++) tags[i].parentNode.removeChild(tags[i]);
  }

  // Get the latest version of the page in the background, ready for next time.
  // Waits a few seconds so it doesn't hold up the sessions loading.
  function refreshCachedPage() {
    setTimeout(function () {
      call('page').then(function (html) {
        if (html && typeof html === 'string' && html !== lsGet(PAGE_KEY)) lsSet(PAGE_KEY, html);
      }).catch(function () {});
    }, 8000);
  }

  // A small "Updating…" label while saved sessions are on screen
  var pill = null, pillTimer = null;
  function syncPill(on) {
    clearTimeout(pillTimer);
    if (!on) { if (pill && pill.parentNode) pill.parentNode.removeChild(pill); pill = null; return; }
    pillTimer = setTimeout(function () { // only if it's taking a moment
      if (pill || !document.body) return;
      pill = document.createElement('div');
      pill.className = 'bm-pill';
      pill.setAttribute('role', 'status');
      pill.textContent = 'Updating…';
      document.body.appendChild(pill);
    }, 400);
  }

  // ---------- Install prompts and notifications ----------
  var OS = null;          // OneSignal, once it's ready
  var installEvent = null; // Android/desktop Chrome install prompt
  var bar = null;
  var shownThisVisit = false;

  function isStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  }
  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }
  function pushSupported() {
    return !!C.oneSignalAppId && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }
  function myName() { return (lsGet('badmintonName') || '').trim(); }
  function pushId(name) { return 'bm:' + name.trim().toLowerCase(); }
  function snoozed(what) {
    var t = Number(lsGet('bm_snooze_' + what) || 0);
    return t && Date.now() - t < 14 * 24 * 3600 * 1000;
  }
  function snooze(what) { lsSet('bm_snooze_' + what, String(Date.now())); }

  function setupInstallAndNotifications() {
    window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); installEvent = e; });
    window.addEventListener('appinstalled', function () { installEvent = null; hideBar(); });

    var base = location.pathname.replace(/[^/]*$/, ''); // e.g. /badminton/
    if (pushSupported()) {
      window.OneSignalDeferred = window.OneSignalDeferred || [];
      window.OneSignalDeferred.push(function (OneSignal) {
        return OneSignal.init({
          appId: C.oneSignalAppId,
          serviceWorkerPath: base.replace(/^\//, '') + 'sw.js',
          serviceWorkerParam: { scope: base },
          notifyButton: { enable: false }
        }).then(function () { OS = OneSignal; syncName(); });
      });
      var s = document.createElement('script');
      s.src = 'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js';
      s.defer = true;
      document.head.appendChild(s);
    } else if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register(abs('sw.js'), { scope: base }).catch(function () {});
    }

    setTimeout(checkPrompts, 2500);
    setInterval(function () { syncName(); checkPrompts(); }, 4000);
  }

  // Ties this phone's notifications to whichever name is picked on the page.
  function syncName() {
    if (!OS || !OS.Notifications || !OS.Notifications.permission) return;
    var name = myName(), last = lsGet('bm_push_name') || '';
    if (name === last) return;
    if (name) { OS.login(pushId(name)); lsSet('bm_push_name', name); }
    else { OS.logout(); lsSet('bm_push_name', null); }
  }

  function whichPrompt() {
    var canAskNotify = OS && pushSupported() && Notification.permission === 'default' && myName() && !snoozed('notify');
    if (isStandalone()) return canAskNotify ? 'notify' : null;
    if (!snoozed('install')) {
      if (isIOS()) return 'install-ios';
      if (installEvent) return 'install';
    }
    return canAskNotify ? 'notify' : null;
  }

  function checkPrompts() {
    if (bar || shownThisVisit) return;
    if (document.querySelector('[role="dialog"]')) return; // don't pile on top of the page's own pop-ups
    var which = whichPrompt();
    if (which) showBar(which);
  }

  var ICON_BELL = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-2 2v1h18v-1Z"/></svg>';
  var ICON_ADD = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm6 4v4H7v2h4v4h2v-4h4v-2h-4V7Z"/></svg>';
  var ICON_SHARE = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" style="vertical-align:-2px"><path fill="currentColor" d="M12 2 7.5 6.5l1.4 1.4L11 5.8V15h2V5.8l2.1 2.1 1.4-1.4ZM5 10v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V10h-2v10H7V10Z"/></svg>';

  function showBar(which) {
    shownThisVisit = true;
    var copy = {
      'notify': { icon: ICON_BELL, title: 'Get notified when you’re off a waitlist', body: 'We’ll also tell you when next month’s sessions open.', yes: 'Turn on', snooze: 'notify' },
      'install': { icon: ICON_ADD, title: 'Add ' + esc(APP_NAME) + ' to your home screen', body: 'Opens full screen, like an app. Optional.', yes: 'Install', snooze: 'install' },
      'install-ios': { icon: ICON_ADD, title: 'Add ' + esc(APP_NAME) + ' to your home screen', body: 'In Safari, tap ' + ICON_SHARE + ' Share, then <b>Add to Home Screen</b>. Optional' + (C.oneSignalAppId ? ', but it’s how you get notifications on iPhone.' : '.'), yes: '', snooze: 'install' }
    }[which];

    bar = document.createElement('div');
    bar.className = 'bm-bar';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'App tip');
    bar.innerHTML =
      '<div class="bm-bar-in">' +
        '<div class="bm-bar-icon">' + copy.icon + '</div>' +
        '<div class="bm-bar-text"><div class="bm-bar-title">' + copy.title + '</div><div class="bm-bar-body">' + copy.body + '</div>' +
          '<div class="bm-bar-actions">' +
            (copy.yes ? '<button type="button" class="bm-btn bm-yes">' + copy.yes + '</button>' : '') +
            '<button type="button" class="bm-btn bm-no">' + (copy.yes ? 'Not now' : 'Got it') + '</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(bar);

    bar.querySelector('.bm-no').onclick = function () { snooze(copy.snooze); hideBar(); };
    var yes = bar.querySelector('.bm-yes');
    if (yes) yes.onclick = function () {
      if (which === 'install' && installEvent) {
        installEvent.prompt();
        installEvent.userChoice.then(function () { installEvent = null; hideBar(); }, hideBar);
      } else if (which === 'notify') {
        turnOnNotifications();
      }
    };
  }

  function hideBar() { if (bar && bar.parentNode) bar.parentNode.removeChild(bar); bar = null; }

  function turnOnNotifications() {
    if (!OS) return;
    var name = myName();
    // Must be called straight from the tap, or iPhones ignore it
    OS.Notifications.requestPermission().then(function () {
      if (OS.Notifications.permission) {
        if (name) { OS.login(pushId(name)); lsSet('bm_push_name', name); }
        toast('Notifications are on for ' + name + '.');
      } else {
        toast('Notifications are blocked. You can allow them for this app in your phone’s settings.');
      }
    }, function () { toast('That didn’t work. Try again in a moment.'); });
  }

  function toast(text) {
    hideBar();
    var t = document.createElement('div');
    t.className = 'bm-bar bm-toast';
    t.setAttribute('role', 'status');
    t.innerHTML = '<div class="bm-bar-in"><div class="bm-bar-text"><div class="bm-bar-body">' + text + '</div></div></div>';
    document.body.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 5000);
  }
})();
