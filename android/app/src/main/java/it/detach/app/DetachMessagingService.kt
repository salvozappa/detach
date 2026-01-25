package it.detach.app

import android.app.PendingIntent
import android.content.Intent
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

private const val TAG = "DetachFCM"

class DetachMessagingService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        Log.d(TAG, "New FCM token: $token")
        // Store token in SharedPreferences for the WebAppInterface to retrieve
        getSharedPreferences("fcm", MODE_PRIVATE)
            .edit()
            .putString("token", token)
            .apply()
    }

    override fun onMessageReceived(message: RemoteMessage) {
        Log.d(TAG, "Message received from: ${message.from}")

        val hookType = message.data["hookType"] ?: "notification"
        val title = message.data["title"] ?: "Claude Code"
        val body = message.data["body"] ?: "Task update"

        Log.d(TAG, "Hook notification: type=$hookType, title=$title, body=$body, appInForeground=${MainActivity.isAppInForeground}")

        // Don't show notification if app is already active
        if (MainActivity.isAppInForeground) {
            Log.d(TAG, "App is in foreground, skipping notification")
            return
        }

        showNotification(hookType, title, body)
    }

    private fun showNotification(hookType: String, title: String, body: String) {
        val channelId = "claude_hooks"
        val notificationId = System.currentTimeMillis().toInt()

        // Intent to open app when notification is tapped
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra("hookType", hookType)
        }
        val pendingIntent = PendingIntent.getActivity(
            this, 0, intent,
            PendingIntent.FLAG_ONE_SHOT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(this, channelId)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(pendingIntent)
            .setColor(ContextCompat.getColor(this, R.color.detach_pink))
            .build()

        try {
            NotificationManagerCompat.from(this).notify(notificationId, notification)
            Log.d(TAG, "Notification shown: id=$notificationId")
        } catch (e: SecurityException) {
            Log.e(TAG, "Failed to show notification (permission denied): ${e.message}")
        }
    }
}
