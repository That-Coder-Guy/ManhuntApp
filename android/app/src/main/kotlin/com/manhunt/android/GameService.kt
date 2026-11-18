package com.manhunt.android

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

/**
 * Keeps the app going while the player is in a lobby.
 *
 * Android stops an app's network and timers soon after its screen goes off
 * or another app comes to the front, and the server drops a player it hasn't
 * heard from for five minutes. While this service runs (it shows "In a lobby"
 * or "Game in progress" in the notification shade, as Android requires), the
 * app and the web view in it stay awake: the player stays in the lobby, their
 * position keeps being sent, and the app hears when someone is found.
 *
 * It runs only between the page saying the player joined a lobby and saying
 * they left (MainActivity.sessionChanged), and stops with the app: swiping
 * the app away is leaving.
 */
class GameService : Service() {

    private var wakeLock: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val lobbyName = intent?.getStringExtra(EXTRA_LOBBY).orEmpty()
        val playing = intent?.getBooleanExtra(EXTRA_PLAYING, false) == true
        val notification = NotificationCompat.Builder(this, Notifications.GAME_CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(getString(if (playing) R.string.game_notification_title else R.string.lobby_notification_title))
            // Changing from "In a lobby" to "Game in progress" shouldn't buzz
            .setOnlyAlertOnce(true)
            .setContentText(lobbyName.ifBlank { getString(R.string.game_notification_text) })
            .setContentIntent(Notifications.openApp(this))
            .setOngoing(true)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()

        try {
            // "location": the game being kept going is one that shares the player's
            // position. (Service types came in with Android 10.)
            val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION else 0
            ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, type)
        } catch (_: SecurityException) {
            // Location was taken away in Settings meanwhile: nothing to keep going
            stopSelf()
            return START_NOT_STICKY
        }

        if (wakeLock == null) {
            // Keeps the processor (not the screen) on with the phone locked,
            // for at most the longest anyone would stay in a lobby; it is let
            // go when they leave
            wakeLock = getSystemService(PowerManager::class.java)
                .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Manhunt:lobby")
                .apply { acquire(LONGEST_SESSION_MS) }
        }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        wakeLock?.takeIf { it.isHeld }?.release()
        wakeLock = null
        super.onDestroy()
    }

    companion object {
        private const val EXTRA_LOBBY = "lobby"
        private const val EXTRA_PLAYING = "playing"
        private const val NOTIFICATION_ID = 1
        private const val LONGEST_SESSION_MS = 8 * 60 * 60 * 1000L

        /**
         * Start (or update) the service. False if Android wouldn't allow it
         * just now: an app in the background can't start one, so the caller
         * tries again when the app is next on screen.
         */
        fun start(context: Context, lobbyName: String, playing: Boolean): Boolean {
            Notifications.ensureChannels(context)
            val intent = Intent(context, GameService::class.java)
                .putExtra(EXTRA_LOBBY, lobbyName)
                .putExtra(EXTRA_PLAYING, playing)
            return try {
                ContextCompat.startForegroundService(context, intent)
                true
            } catch (_: IllegalStateException) {
                false
            } catch (_: SecurityException) {
                false
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, GameService::class.java))
        }
    }
}

/** The app's notifications: the ongoing one while in a lobby, and "someone was found" */
object Notifications {
    const val GAME_CHANNEL = "game"
    private const val FOUND_CHANNEL = "found"
    private const val FOUND_ID = 2

    fun ensureChannels(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        // Quiet: it's only there to say the app is running
        manager.createNotificationChannel(
            NotificationChannel(GAME_CHANNEL, context.getString(R.string.channel_game), NotificationManager.IMPORTANCE_LOW)
        )
        // Heard and seen straight away: the game just changed
        manager.createNotificationChannel(
            NotificationChannel(FOUND_CHANNEL, context.getString(R.string.channel_found), NotificationManager.IMPORTANCE_HIGH)
        )
    }

    fun allowed(context: Context) = NotificationManagerCompat.from(context).areNotificationsEnabled()

    /** Tapping a notification brings the app (and the game in it) back to the front */
    fun openApp(context: Context): PendingIntent = PendingIntent.getActivity(
        context,
        0,
        Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )

    /** "Maya was found": a newer one replaces an older one */
    fun showFound(context: Context, title: String, body: String) {
        if (!allowed(context)) return
        ensureChannels(context)
        val notification = NotificationCompat.Builder(context, FOUND_CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(body)
            .setContentIntent(openApp(context))
            .setAutoCancel(true)
            .build()
        context.getSystemService(NotificationManager::class.java).notify(FOUND_ID, notification)
    }

    fun clearFound(context: Context) {
        context.getSystemService(NotificationManager::class.java).cancel(FOUND_ID)
    }
}
