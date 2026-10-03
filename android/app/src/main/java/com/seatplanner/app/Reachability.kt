package com.seatplanner.app

import java.io.IOException
import java.net.ConnectException
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import java.net.UnknownHostException

/** "Test connection" on the server screen. Blocks, so it runs off the main thread. */
object Reachability {

    sealed interface Outcome {
        data class Reached(val status: Int, val millis: Long) : Outcome
        data class Failed(val reason: String) : Outcome
    }

    private const val TIMEOUT_MS = 5_000

    fun check(server: String): Outcome {
        val started = System.nanoTime()
        val connection = try {
            URL(server).openConnection() as HttpURLConnection
        } catch (e: IOException) {
            return Outcome.Failed(e.message ?: e.javaClass.simpleName)
        }
        return try {
            connection.connectTimeout = TIMEOUT_MS
            connection.readTimeout = TIMEOUT_MS
            connection.instanceFollowRedirects = false // a redirect to /login is an answer too
            val status = connection.responseCode
            Outcome.Reached(status, (System.nanoTime() - started) / 1_000_000)
        } catch (e: SocketTimeoutException) {
            Outcome.Failed("no answer in ${TIMEOUT_MS / 1000} s — same Wi-Fi? firewall?")
        } catch (e: ConnectException) {
            Outcome.Failed("nothing is listening on that port — is the dev server running?")
        } catch (e: UnknownHostException) {
            Outcome.Failed("unknown address")
        } catch (e: IOException) {
            Outcome.Failed(e.message ?: e.javaClass.simpleName)
        } finally {
            connection.disconnect()
        }
    }
}
