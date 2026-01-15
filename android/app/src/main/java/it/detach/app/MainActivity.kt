package it.detach.app

import android.annotation.SuppressLint
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import it.detach.app.ui.theme.DetachitTheme

class MainActivity : ComponentActivity() {

    private var webView: WebView? = null

    override fun onCreate(savedInstanceState: Bundle?) {
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
                    modifier = Modifier.fillMaxSize(),
                    onWebViewCreated = { webView = it }
                )
            }
        }
    }

    override fun onResume() {
        super.onResume()
        webView?.onResume()
    }

    override fun onPause() {
        webView?.onPause()
        super.onPause()
    }

    override fun onDestroy() {
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

            webChromeClient = WebChromeClient()

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
