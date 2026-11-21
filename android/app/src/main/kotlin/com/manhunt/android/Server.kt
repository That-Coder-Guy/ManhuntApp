package com.manhunt.android

import org.json.JSONException
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/**
 * The game server the app shows. It is built in (BuildConfig.SERVER, from
 * app/build.gradle.kts): the game is hosted at one address that doesn't
 * change, so there is nothing to type or choose.
 */
object Server {
    private const val TIMEOUT_MS = 10_000

    /** "https://host", or "https://host:port" */
    const val ORIGIN: String = BuildConfig.SERVER

    val host: String = ORIGIN.removePrefix("https://")

    sealed interface Check {
        data object Ok : Check

        /** Nothing answered; with Android's own words for why */
        data class Unreachable(val reason: String) : Check

        /** Something answered, but not a Manhunt server: its HTTP status, or null if that was fine */
        data class NotManhunt(val httpStatus: Int?) : Check
    }

    /** Makes sure the Manhunt server answers (its health check). Blocks: not for the main thread. */
    fun check(): Check {
        val connection = try {
            URL("$ORIGIN/manhunt-api/health").openConnection() as HttpURLConnection
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
