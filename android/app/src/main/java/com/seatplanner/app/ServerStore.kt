package com.seatplanner.app

import android.content.Context

/**
 * Which server the app is on, and the local ones used lately.
 *
 * Kept on the phone only. Production is the absence of a choice, so clearing
 * the app's data — or a stored address that no longer passes the checks —
 * always lands on the live site.
 */
class ServerStore(context: Context) {

    private val prefs = context.getSharedPreferences("server", Context.MODE_PRIVATE)

    /** The local server in use, or null on production. */
    val local: String?
        get() = Servers.parseLocal(prefs.getString(KEY_LOCAL, null))

    /** The server to load pages from. */
    val current: String
        get() = local ?: Servers.production

    /** Local servers used before, newest first. */
    val recent: List<String>
        get() = prefs.getString(KEY_RECENT, null).orEmpty()
            .split('\n')
            .mapNotNull(Servers::parseLocal)

    fun useLocal(url: String) {
        val clean = requireNotNull(Servers.parseLocal(url)) { "Not a local server: $url" }
        val recent = (listOf(clean) + recent.filter { it != clean }).take(MAX_RECENT)
        prefs.edit()
            .putString(KEY_LOCAL, clean)
            .putString(KEY_RECENT, recent.joinToString("\n"))
            .apply()
    }

    fun useProduction() {
        prefs.edit().remove(KEY_LOCAL).apply()
    }

    private companion object {
        const val KEY_LOCAL = "local"
        const val KEY_RECENT = "recent"
        const val MAX_RECENT = 5
    }
}
