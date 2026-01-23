package it.detach.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.util.Log
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import com.google.firebase.messaging.FirebaseMessaging
import it.detach.app.ui.theme.DetachitTheme

private const val TAG = "DetachActivity"

class WebAppInterface(private val context: Context) {
    @JavascriptInterface
    fun logFromWebView(level: String, tag: String, message: String) {
        when (level) {
            "debug" -> Log.d("WV:$tag", message)
            "info" -> Log.i("WV:$tag", message)
            "warn" -> Log.w("WV:$tag", message)
            "error" -> Log.e("WV:$tag", message)
            else -> Log.v("WV:$tag", message)
        }
    }

    @JavascriptInterface
    fun getFcmToken(): String {
        val token = context.getSharedPreferences("fcm", Context.MODE_PRIVATE)
            .getString("token", "") ?: ""
        Log.d(TAG, "getFcmToken called from JS, returning token: ${if (token.isNotEmpty()) token.substring(0, minOf(20, token.length)) + "..." else "empty"}")
        return token
    }
}

class MainActivity : ComponentActivity() {

    private var webView: WebView? = null
    private lateinit var connectivityManager: ConnectivityManager
    private var isNetworkAvailable = true

    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            Log.d(TAG, "Network available (waiting for validation)")
        }

        override fun onLost(network: Network) {
            Log.d(TAG, "Network lost - checking if any network remains")
            // Check if there's still an active network (might have switched networks)
            val activeNetwork = connectivityManager.activeNetwork
            if (activeNetwork == null && isNetworkAvailable) {
                Log.d(TAG, "No active network remaining - dispatching offline event")
                isNetworkAvailable = false
                runOnUiThread {
                    webView?.evaluateJavascript(
                        "window.dispatchEvent(new CustomEvent('androidNetworkOffline', { detail: { timestamp: ${System.currentTimeMillis()}, reason: 'network_lost' } }));",
                        null
                    )
                }
            }
        }

        override fun onUnavailable() {
            Log.d(TAG, "Network unavailable")
            if (isNetworkAvailable) {
                isNetworkAvailable = false
                runOnUiThread {
                    webView?.evaluateJavascript(
                        "window.dispatchEvent(new CustomEvent('androidNetworkOffline', { detail: { timestamp: ${System.currentTimeMillis()}, reason: 'unavailable' } }));",
                        null
                    )
                }
            }
        }

        override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) {
            val hasInternet = capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            val hasValidated = capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)

            // Check if airplane mode is on - don't trust network capabilities during airplane mode
            val isAirplaneModeOn = Settings.Global.getInt(
                contentResolver,
                Settings.Global.AIRPLANE_MODE_ON,
                0
            ) != 0

            Log.d(TAG, "Network capabilities changed: internet=$hasInternet, validated=$hasValidated, airplaneMode=$isAirplaneModeOn, wasAvailable=$isNetworkAvailable")

            // Network is usable when it has both internet and validation AND airplane mode is off
            val isUsable = hasInternet && hasValidated && !isAirplaneModeOn

            if (isUsable && !isNetworkAvailable) {
                Log.d(TAG, "Network became usable - dispatching online event")
                isNetworkAvailable = true
                runOnUiThread {
                    webView?.evaluateJavascript(
                        "window.dispatchEvent(new CustomEvent('androidNetworkOnline', { detail: { timestamp: ${System.currentTimeMillis()} } }));",
                        null
                    )
                }
            }
        }
    }

    // BroadcastReceiver for airplane mode changes
    private val airplaneModeReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            Log.d(TAG, "Airplane broadcast received: action=${intent?.action}")

            if (intent?.action == Intent.ACTION_AIRPLANE_MODE_CHANGED) {
                // Get state from intent extra (more reliable than Settings query)
                val isOnFromIntent = intent.getBooleanExtra("state", false)

                // Also check Settings as fallback
                val isOnFromSettings = Settings.Global.getInt(
                    contentResolver,
                    Settings.Global.AIRPLANE_MODE_ON,
                    0
                ) != 0

                Log.d(TAG, "Airplane mode changed: fromIntent=$isOnFromIntent, fromSettings=$isOnFromSettings, wasNetworkAvailable=$isNetworkAvailable")

                val isAirplaneModeOn = isOnFromIntent || isOnFromSettings

                if (isAirplaneModeOn && isNetworkAvailable) {
                    Log.d(TAG, "Airplane mode ON - dispatching offline event")
                    isNetworkAvailable = false
                    webView?.evaluateJavascript(
                        "window.dispatchEvent(new CustomEvent('androidNetworkOffline', { detail: { timestamp: ${System.currentTimeMillis()}, reason: 'airplane_mode' } }));",
                        null
                    )
                }
                // When airplane mode turns OFF, the networkCallback.onCapabilitiesChanged
                // will handle dispatching the online event once network is validated
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        Log.d(TAG, "onCreate: savedInstanceState=${savedInstanceState != null}")
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        // Set up notification channel for Claude Code hooks
        createNotificationChannel()

        // Request notification permission (Android 13+)
        requestNotificationPermission()

        // Initialize FCM token
        initializeFcmToken()

        // Set up network connectivity monitoring
        // Use registerDefaultNetworkCallback to monitor the system's active network
        connectivityManager = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        connectivityManager.registerDefaultNetworkCallback(networkCallback)

        // Register airplane mode receiver for immediate detection
        // Use RECEIVER_EXPORTED for system broadcasts like airplane mode
        val airplaneModeFilter = IntentFilter(Intent.ACTION_AIRPLANE_MODE_CHANGED)
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(airplaneModeReceiver, airplaneModeFilter, Context.RECEIVER_EXPORTED)
        } else {
            registerReceiver(airplaneModeReceiver, airplaneModeFilter)
        }

        // Handle back button for WebView navigation
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView?.canGoBack() == true) {
                    webView?.goBack()
                } else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })

        setContent {
            DetachitTheme {
                DetachWebView(
                    url = "file:///android_asset/index.html",
                    modifier = Modifier
                        .fillMaxSize()
                        .background(Color.Black)
                        .safeDrawingPadding(),
                    onWebViewCreated = { webView = it }
                )
            }
        }
    }

    override fun onStart() {
        Log.d(TAG, "onStart")
        super.onStart()
    }

    override fun onResume() {
        Log.d(TAG, "onResume: webView=${webView != null}")
        super.onResume()

        // Check current network state on resume (in case it changed while backgrounded)
        val activeNetwork = connectivityManager.activeNetwork
        val capabilities = activeNetwork?.let { connectivityManager.getNetworkCapabilities(it) }
        val hasInternet = capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true
        val hasValidated = capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true
        val isCurrentlyConnected = hasInternet && hasValidated

        Log.d(TAG, "onResume: network check - activeNetwork=$activeNetwork, hasInternet=$hasInternet, hasValidated=$hasValidated, wasAvailable=$isNetworkAvailable")

        webView?.let {
            Log.d(TAG, "onResume: calling webView.onResume()")
            it.onResume()

            // If network state changed while backgrounded, notify JS
            if (!isCurrentlyConnected && isNetworkAvailable) {
                Log.d(TAG, "onResume: network lost while backgrounded - dispatching offline event")
                isNetworkAvailable = false
                it.evaluateJavascript(
                    "window.dispatchEvent(new CustomEvent('androidNetworkOffline', { detail: { timestamp: ${System.currentTimeMillis()}, reason: 'resume_check' } }));",
                    null
                )
            }

            it.evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('androidResume', { detail: { timestamp: ${System.currentTimeMillis()} } }));",
                null
            )
        }
    }

    override fun onPause() {
        Log.d(TAG, "onPause: webView=${webView != null}")
        webView?.let {
            Log.d(TAG, "onPause: dispatching androidPause event")
            it.evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('androidPause', { detail: { timestamp: ${System.currentTimeMillis()} } }));",
                null
            )
            Log.d(TAG, "onPause: calling webView.onPause()")
            it.onPause()
        }
        super.onPause()
    }

    override fun onStop() {
        Log.d(TAG, "onStop")
        super.onStop()
    }

    override fun onDestroy() {
        Log.d(TAG, "onDestroy: webView=${webView != null}")
        connectivityManager.unregisterNetworkCallback(networkCallback)
        unregisterReceiver(airplaneModeReceiver)
        webView?.destroy()
        webView = null
        super.onDestroy()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                "claude_hooks",
                "Claude Code Updates",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Notifications from Claude Code (task completion, permission requests)"
            }
            val notificationManager = getSystemService(NotificationManager::class.java)
            notificationManager.createNotificationChannel(channel)
            Log.d(TAG, "Notification channel created: claude_hooks")
        }
    }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                Log.d(TAG, "Requesting POST_NOTIFICATIONS permission")
                requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), NOTIFICATION_PERMISSION_REQUEST_CODE)
            } else {
                Log.d(TAG, "POST_NOTIFICATIONS permission already granted")
            }
        }
    }

    private fun initializeFcmToken() {
        Log.d(TAG, "initializeFcmToken: Requesting FCM token...")
        FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
            if (!task.isSuccessful) {
                Log.e(TAG, "initializeFcmToken: Failed to get FCM token", task.exception)
                return@addOnCompleteListener
            }

            val token = task.result
            Log.d(TAG, "initializeFcmToken: Received FCM token: ${token.substring(0, minOf(20, token.length))}...")

            // Store token in SharedPreferences
            getSharedPreferences("fcm", MODE_PRIVATE)
                .edit()
                .putString("token", token)
                .apply()

            Log.d(TAG, "initializeFcmToken: Token stored in SharedPreferences")
        }
    }

    companion object {
        private const val NOTIFICATION_PERMISSION_REQUEST_CODE = 1001
    }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun DetachWebView(
    url: String,
    modifier: Modifier = Modifier,
    onWebViewCreated: (WebView) -> Unit = {}
) {
    val context = LocalContext.current

    val webView = remember {
        WebView(context).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )

            settings.apply {
                // Enable JavaScript for xterm.js, highlight.js, etc.
                javaScriptEnabled = true

                // Enable DOM storage for localStorage (session persistence)
                domStorageEnabled = true

                // Allow loading resources from CDNs
                allowContentAccess = true
                allowFileAccess = false

                // Cache mode
                cacheMode = WebSettings.LOAD_DEFAULT

                // Viewport settings
                useWideViewPort = true
                loadWithOverviewMode = true

                // Disable zoom (web app is mobile-optimized)
                setSupportZoom(false)
                builtInZoomControls = false
                displayZoomControls = false

                // HTTPS only
                mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            }

            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(
                    view: WebView?,
                    request: WebResourceRequest?
                ): Boolean {
                    // Keep all navigation within WebView
                    return false
                }
            }

            webChromeClient = object : WebChromeClient() {
                override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
                    consoleMessage?.let {
                        val logLevel = when (it.messageLevel()) {
                            ConsoleMessage.MessageLevel.ERROR -> Log.ERROR
                            ConsoleMessage.MessageLevel.WARNING -> Log.WARN
                            ConsoleMessage.MessageLevel.DEBUG -> Log.DEBUG
                            else -> Log.INFO
                        }
                        Log.println(
                            logLevel,
                            "WV:Console",
                            "${it.sourceId()}:${it.lineNumber()} - ${it.message()}"
                        )
                    }
                    return true
                }
            }

            addJavascriptInterface(WebAppInterface(context), "Android")

            loadUrl(url)
        }
    }

    DisposableEffect(webView) {
        onWebViewCreated(webView)
        onDispose { }
    }

    AndroidView(
        factory = { webView },
        modifier = modifier
    )
}
