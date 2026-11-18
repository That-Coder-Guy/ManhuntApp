package com.manhunt.android

import android.content.Context
import org.json.JSONException
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import java.net.URISyntaxException
import java.net.URL

/**
 * Which game server the app shows. The address is typed in once and kept; a
 * quick tunnel's address changes when the tunnel restarts, so it can be
 * changed again later.
 */
class ServerStore(context: Context) {
    private val preferences = context.getSharedPreferences("server", Context.MODE_PRIVATE)

    /** The server in use ("https://host"), or null until one has been chosen */
    var origin: String?
        get() = preferences.getString(KEY, null)?.let(::normalize)
        set(value) = preferences.edit().putString(KEY, value).apply()

    sealed interface Check {
        data object Ok : Check

        /** Nothing answered; with Android's own words for why */
        data class Unreachable(val reason: String) : Check

        /** Something answered, but not a Manhunt server: its HTTP status, or null if that was fine */
        data class NotManhunt(val httpStatus: Int?) : Check
    }

    companion object {
        private const val KEY = "origin"
        private const val TIMEOUT_MS = 10_000

        /**
         * The server's address from what was typed: "name.trycloudflare.com",
         * a full invite link, or anything between. Only https works: the
         * camera and compass need it.
         */
        fun normalize(text: String): String? {
            var address = text.trim()
            if (address.isEmpty()) return null
            if (address.startsWith("http://", ignoreCase = true)) return null
            if (!address.startsWith("https://", ignoreCase = true)) address = "https://$address"

            val typed = try { URI(address) } catch (_: URISyntaxException) { return null }
            val host = typed.host?.lowercase() ?: return null
            if (!host.contains('.') || host.endsWith('.')) return null
            return if (typed.port == -1 || typed.port == 443) "https://$host" else "https://$host:${typed.port}"
        }

        fun host(origin: String): String = origin.removePrefix("https://")

        /** Makes sure a Manhunt server answers at `origin` (its health check). Blocks: not for the main thread. */
        fun check(origin: String): Check {
            val connection = try {
                URL("$origin/manhunt-api/health").openConnection() as HttpURLConnection
            } catch (error: IOException) {
                return Check.Unreachable(describe(error))
            }
            return try {
                connection.connectTimeout = TIMEOUT_MS
                connection.readTimeout = TIMEOUT_MS
                connection.useCaches = false
                val status = connection.responseCode
                if (status != 200) return Check.NotManhunt(status)

                val body = connection.inputStream.bufferedReader().use { it.readText() }
                val healthy = try { JSONObject(body).optString("status") == "success" } catch (_: JSONException) { false }
                if (healthy) Check.Ok else Check.NotManhunt(null)
            } catch (error: IOException) {
                Check.Unreachable(describe(error))
            } finally {
                connection.disconnect()
            }
        }

        private fun describe(error: IOException): String =
            error.localizedMessage?.takeIf { it.isNotBlank() } ?: error.javaClass.simpleName
    }
}
