package it.detach.app

import android.annotation.SuppressLint
import android.content.Context
import android.os.Bundle
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
}

class MainActivity : ComponentActivity() {

    private var webView: WebView? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        Log.d(TAG, "onCreate: savedInstanceState=${savedInstanceState != null}")
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

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
                    url = "https://nightly01.tail5fb253.ts.net/",
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
        webView?.let {
            Log.d(TAG, "onResume: calling webView.onResume()")
            it.onResume()
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
        webView?.destroy()
        webView = null
        super.onDestroy()
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

                // Enable database storage
                databaseEnabled = true

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
