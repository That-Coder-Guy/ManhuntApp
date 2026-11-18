package com.manhunt.android

import android.annotation.SuppressLint
import android.content.Context
import android.view.View
import android.webkit.WebView

/**
 * A web view that can be told to carry on as if it were on screen.
 *
 * A web view whose window is hidden (the phone locked, another app in front)
 * treats its page as a background tab: timers slow to a crawl and location
 * stops. While the player is in a lobby the page has to keep sending where
 * they are, so with `stayAwake` set it is never told its window went away.
 * (GameService is what keeps Android from stopping the app altogether.)
 */
@SuppressLint("ViewConstructor")
class GameWebView(context: Context) : WebView(context) {

    var stayAwake = false
        set(value) {
            if (field == value) return
            field = value
            // Back to the truth, whichever way it changed
            super.onWindowVisibilityChanged(windowVisibility)
        }

    override fun onWindowVisibilityChanged(visibility: Int) {
        super.onWindowVisibilityChanged(if (stayAwake) View.VISIBLE else visibility)
    }
}
