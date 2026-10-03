package com.seatplanner.app

import android.graphics.Color
import android.os.Bundle
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.RadioGroup
import android.widget.TextView
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.isVisible
import androidx.core.widget.doAfterTextChanged
import com.google.android.material.appbar.MaterialToolbar
import com.google.android.material.button.MaterialButton
import com.google.android.material.chip.Chip
import com.google.android.material.chip.ChipGroup
import com.google.android.material.textfield.TextInputEditText
import com.google.android.material.textfield.TextInputLayout
import kotlin.concurrent.thread

/**
 * The hidden server screen: production, a computer on the same Wi-Fi, or one
 * plugged in over USB.
 *
 * Reached by holding three fingers on the page, or from the error page while
 * on a local server. Scanning the QR code on a computer's "Open on phone" page
 * does the same switch without coming here.
 */
class ServerActivity : AppCompatActivity() {

    private lateinit var store: ServerStore
    private lateinit var choice: RadioGroup
    private lateinit var addressLayout: TextInputLayout
    private lateinit var address: TextInputEditText
    private lateinit var result: TextView

    /** Bumped on every test, so an old answer arriving late is ignored. */
    private var testRun = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT),
        )
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_server)
        store = ServerStore(this)

        val root = findViewById<View>(R.id.server_root)
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val keyboard = insets.getInsets(WindowInsetsCompat.Type.ime())
            view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, keyboard.bottom))
            WindowInsetsCompat.CONSUMED
        }

        findViewById<MaterialToolbar>(R.id.toolbar).setNavigationOnClickListener { finish() }

        choice = findViewById(R.id.choice)
        addressLayout = findViewById(R.id.address_layout)
        address = findViewById(R.id.address)
        result = findViewById(R.id.test_result)

        findViewById<TextView>(R.id.production_address).text = Servers.label(Servers.production)
        findViewById<TextView>(R.id.usb_address).text = Servers.label(USB)
        findViewById<TextView>(R.id.now_showing).text = store.local?.let {
            getString(R.string.server_now_local, Servers.label(it))
        } ?: getString(R.string.server_now_production)
        findViewById<TextView>(R.id.footer).text = getString(R.string.server_footer, BuildConfig.VERSION_NAME)

        val local = store.local
        val wifiRecent = store.recent.filter { it != USB }
        when {
            local == null -> choice.check(R.id.option_production)
            local == USB -> choice.check(R.id.option_usb)
            else -> choice.check(R.id.option_wifi)
        }
        address.setText(Servers.label((local ?: wifiRecent.firstOrNull()) ?: "").takeIf { local != USB })

        val chips = findViewById<ChipGroup>(R.id.recent)
        findViewById<View>(R.id.recent_label).isVisible = wifiRecent.isNotEmpty()
        wifiRecent.forEach { url ->
            chips.addView(Chip(this).apply {
                text = Servers.label(url)
                setOnClickListener {
                    choice.check(R.id.option_wifi)
                    address.setText(Servers.label(url))
                    address.setSelection(address.length())
                }
            })
        }

        choice.setOnCheckedChangeListener { _, _ -> onChoiceChanged() }
        address.setOnFocusChangeListener { _, focused -> if (focused) choice.check(R.id.option_wifi) }
        address.doAfterTextChanged {
            addressLayout.error = null
            clearResult()
        }
        address.setOnEditorActionListener { _, action, _ ->
            if (action == EditorInfo.IME_ACTION_DONE) use()
            action == EditorInfo.IME_ACTION_DONE
        }

        findViewById<MaterialButton>(R.id.test).setOnClickListener { chosen()?.let(::test) }
        findViewById<MaterialButton>(R.id.use).setOnClickListener { use() }
        onChoiceChanged()
    }

    private fun onChoiceChanged() {
        addressLayout.error = null
        clearResult()
    }

    /** The server picked on screen, or null (with the reason shown) when the address is not usable. */
    private fun chosen(): String? = when (choice.checkedRadioButtonId) {
        R.id.option_production -> Servers.production
        R.id.option_usb -> USB
        else -> Servers.parseLocal(address.text?.toString()).also {
            if (it == null) addressLayout.error = getString(R.string.server_address_error)
        }
    }

    private fun use() {
        val server = chosen() ?: return
        if (server == Servers.production) store.useProduction() else store.useLocal(server)
        finish() // MainActivity loads it on resume
    }

    private fun test(server: String) {
        val run = ++testRun
        result.isVisible = true
        result.setTextColor(getColor(R.color.muted))
        result.text = getString(R.string.server_testing, Servers.label(server))
        thread(name = "server-test") {
            val outcome = Reachability.check(server)
            runOnUiThread {
                if (run != testRun || isDestroyed) return@runOnUiThread
                when (outcome) {
                    is Reachability.Outcome.Reached -> {
                        result.setTextColor(getColor(R.color.ok))
                        result.text = getString(R.string.server_reached, Servers.label(server), outcome.status, outcome.millis)
                    }
                    is Reachability.Outcome.Failed -> {
                        result.setTextColor(getColor(R.color.bad))
                        result.text = getString(R.string.server_unreached, Servers.label(server), outcome.reason)
                    }
                }
            }
        }
    }

    private fun clearResult() {
        testRun++
        result.isVisible = false
    }

    private companion object {
        /** A computer over USB, once `adb reverse tcp:3000 tcp:3000` forwards the port. */
        val USB = requireNotNull(Servers.parseLocal("localhost:${Servers.DEFAULT_PORT}"))
    }
}
