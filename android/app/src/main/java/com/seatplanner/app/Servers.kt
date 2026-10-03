package com.seatplanner.app

import java.net.URI
import java.net.URLDecoder

/**
 * The servers the app can show pages from.
 *
 * Production is built in. The only others allowed are on this phone's own
 * network: a developer's computer on the same Wi-Fi, or `localhost` when the
 * phone is plugged in and `adb reverse` forwards the port. A switch link can
 * arrive from any QR code, so refusing everything else is what stops a
 * stranger's code from dressing some other website up as this app.
 */
object Servers {

    /** The live site, set in app/build.gradle.kts. */
    val production: String = BuildConfig.PRODUCTION_URL

    /** Next.js's port, assumed when an address is typed without one. */
    const val DEFAULT_PORT = 3000

    /** Where the switch link lives on the production site (an App Link). */
    const val LINK_PATH = "/app/server"

    /** The same link as a custom scheme, `seatplanner://server?url=…`. */
    const val LINK_SCHEME = "seatplanner"
    const val LINK_HOST = "server"

    /** What a switch link asked for. */
    sealed interface LinkRequest {
        /** A server on this network, ready to use. */
        data class Switch(val url: String) : LinkRequest

        /** A switch link whose address is not allowed; [asked] is what it carried. */
        data class Refused(val asked: String) : LinkRequest
    }

    /**
     * Read a local server address — as typed (`192.168.0.12:3000`) or as a
     * link carried it (`http://192.168.0.12:3000`) — and return it as
     * `scheme://host:port`, or null when it is not an address on this network.
     *
     * Only an address: a path, query, fragment or user name makes it null, so
     * the app always opens the server's own front page.
     */
    fun parseLocal(input: String?): String? {
        val text = input?.trim().orEmpty()
        if (text.isEmpty() || text.any { it.isWhitespace() }) return null

        val uri = try {
            URI(if ("://" in text) text else "http://$text")
        } catch (e: Exception) {
            return null
        }

        val scheme = uri.scheme?.lowercase() ?: return null
        if (scheme != "http" && scheme != "https") return null
        if (uri.rawUserInfo != null || uri.rawQuery != null || uri.rawFragment != null) return null
        if (!uri.rawPath.isNullOrEmpty() && uri.rawPath != "/") return null

        val host = uri.host?.lowercase() ?: return null
        if (!isLocalHost(host)) return null

        val port = if (uri.port == -1) DEFAULT_PORT else uri.port
        if (port !in 1..65535) return null

        return "$scheme://$host:$port"
    }

    /** `localhost`, or an IPv4 address in a private or loopback range. */
    fun isLocalHost(host: String): Boolean {
        if (host == "localhost") return true

        val parts = host.split(".")
        if (parts.size != 4) return false
        if (parts.any { it.isEmpty() || it.length > 3 || !it.all(Char::isDigit) }) return false
        val n = parts.map(String::toInt)
        if (n.any { it > 255 }) return false

        return n[0] == 10 ||
            n[0] == 127 ||
            (n[0] == 172 && n[1] in 16..31) ||
            (n[0] == 192 && n[1] == 168)
    }

    /** How a server is named on screen: `192.168.0.12:3000`. */
    fun label(url: String): String = url.substringAfter("://").trimEnd('/')

    /**
     * What a link asks for, or null when it is not a switch link at all.
     *
     * Two forms say the same thing: the App Link
     * `https://<production>/app/server?url=…`, which a phone camera opens
     * here once Android has verified the site, and `seatplanner://server?url=…`,
     * which the site's own page uses when it has not.
     */
    fun readLink(link: String): LinkRequest? {
        val uri = try {
            URI(link)
        } catch (e: Exception) {
            return null
        }

        val path = uri.path.orEmpty().trimEnd('/')
        val isAppLink = uri.scheme == "https" &&
            uri.host.equals(URI(production).host, ignoreCase = true) &&
            path == LINK_PATH
        val isCustom = uri.scheme.equals(LINK_SCHEME, ignoreCase = true) &&
            uri.host.equals(LINK_HOST, ignoreCase = true)
        if (!isAppLink && !isCustom) return null

        val asked = queryParam(uri.rawQuery, "url").orEmpty()
        return parseLocal(asked)?.let { LinkRequest.Switch(it) } ?: LinkRequest.Refused(asked)
    }

    private fun queryParam(rawQuery: String?, name: String): String? =
        rawQuery.orEmpty()
            .split('&')
            .map { it.split('=', limit = 2) }
            .firstOrNull { decode(it[0]) == name }
            ?.getOrNull(1)
            ?.let(::decode)

    private fun decode(text: String): String = try {
        URLDecoder.decode(text, "UTF-8")
    } catch (e: IllegalArgumentException) {
        text
    }
}
