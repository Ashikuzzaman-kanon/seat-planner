package com.seatplanner.app

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.view.MotionEvent
import android.view.ViewConfiguration
import kotlin.math.abs

/**
 * Three fingers held still on the screen for [HOLD_MS]: the hidden way to the
 * server screen when there is no QR code to scan.
 *
 * Nothing on screen hints at it, a passenger does not do it by accident, and it
 * needs nothing from the web page. MainActivity feeds it every touch; the
 * touches still reach the page as usual.
 */
class ThreeFingerHold(context: Context, private val onHold: () -> Unit) {

    private val handler = Handler(Looper.getMainLooper())

    // Fingers drift a little when held, more than a tap's slop allows.
    private val slop = ViewConfiguration.get(context).scaledTouchSlop * 3f

    private val startX = FloatArray(FINGERS)
    private val startY = FloatArray(FINGERS)
    private var armed = false

    private val fire = Runnable {
        armed = false
        onHold()
    }

    fun onTouch(event: MotionEvent) {
        when (event.actionMasked) {
            MotionEvent.ACTION_POINTER_DOWN ->
                if (event.pointerCount == FINGERS) arm(event) else cancel()

            MotionEvent.ACTION_MOVE ->
                if (armed && moved(event)) cancel()

            MotionEvent.ACTION_POINTER_UP,
            MotionEvent.ACTION_UP,
            MotionEvent.ACTION_CANCEL -> cancel()
        }
    }

    fun cancel() {
        armed = false
        handler.removeCallbacks(fire)
    }

    private fun arm(event: MotionEvent) {
        for (i in 0 until FINGERS) {
            startX[i] = event.getX(i)
            startY[i] = event.getY(i)
        }
        armed = true
        handler.removeCallbacks(fire)
        handler.postDelayed(fire, HOLD_MS)
    }

    private fun moved(event: MotionEvent): Boolean =
        (0 until minOf(FINGERS, event.pointerCount)).any { i ->
            abs(event.getX(i) - startX[i]) > slop || abs(event.getY(i) - startY[i]) > slop
        }

    companion object {
        const val FINGERS = 3
        const val HOLD_MS = 3_000L
    }
}
