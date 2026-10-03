package com.seatplanner.app

/**
 * The small scripts the app runs inside the site's pages.
 *
 * Both talk to the app through [BRIDGE], a JavaScript object Android puts on
 * the page for the server's own origin only (see MainActivity.connectBridge).
 */
object PageScripts {

    /** The page's name for the app: `window.SeatPlannerApp.postMessage(json)`. */
    const val BRIDGE = "SeatPlannerApp"

    /**
     * Tells the app, as each touch starts, whether pulling down should be left
     * to the page instead of reloading it: the touch began inside something
     * already scrolled (a table, the menu drawer), or a dialog or the drawer is
     * open. The app only knows how far the whole page is scrolled.
     *
     * Runs at the start of every document; the flag keeps it to one listener.
     */
    val PULL_GUARD = """
        (function () {
          if (window.__seatPlannerPull) return;
          window.__seatPlannerPull = true;
          var last = null;
          function blocked(target) {
            if (window.scrollY > 0) return true;
            if (document.querySelector('.p-dialog-mask, .p-sidebar-mask, .dash-layout.menu-open')) return true;
            for (var el = target; el && el.nodeType === 1; el = el.parentElement) {
              if (el.scrollTop > 0) return true;
            }
            return false;
          }
          window.addEventListener('touchstart', function (e) {
            var now = blocked(e.target);
            if (now === last || !window.$BRIDGE) return;
            last = now;
            window.$BRIDGE.postMessage(JSON.stringify({ type: 'pull', blocked: now }));
          }, { capture: true, passive: true });
        })();
    """.trimIndent()

    /**
     * The back button closes what Escape closes — a dialog, the notification
     * panel, the menu drawer — before it leaves the page. Answers `true` when
     * there was something to close.
     */
    val CLOSE_LAYER = """
        (function () {
          if (!document.querySelector('.p-dialog-mask, .p-overlaypanel, .dash-layout.menu-open')) return false;
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
          return true;
        })();
    """.trimIndent()
}
