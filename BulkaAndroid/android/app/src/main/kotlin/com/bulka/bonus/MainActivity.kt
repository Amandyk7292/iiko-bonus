package com.bulka.bonus

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MainActivity : FlutterActivity() {
    private val orderStatusChannel = "com.bulka.bonus/order_status"
    private val orderNotificationChannel = "bulka_order_status"
    private val orderNotificationId = 4021

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(
                NotificationChannel(
                    "bulka_bonus_notifications",
                    getString(R.string.notification_channel_general_name),
                    NotificationManager.IMPORTANCE_HIGH,
                ).apply {
                    description = getString(R.string.notification_channel_general_description)
                },
            )
            manager.createNotificationChannel(
                NotificationChannel(
                    orderNotificationChannel,
                    getString(R.string.notification_channel_order_name),
                    NotificationManager.IMPORTANCE_LOW,
                ).apply {
                    description = getString(R.string.notification_channel_order_description)
                    setShowBadge(false)
                    lockscreenVisibility = Notification.VISIBILITY_PRIVATE
                },
            )
        }
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, orderStatusChannel)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "updateOrderStatus" -> {
                        showOrderStatus(call.arguments as? Map<*, *> ?: emptyMap<String, Any>())
                        result.success(null)
                    }
                    "clearOrderStatus" -> {
                        getSystemService(NotificationManager::class.java)
                            .cancel(orderNotificationId)
                        result.success(null)
                    }
                    else -> result.notImplemented()
                }
            }
    }

    private fun showOrderStatus(payload: Map<*, *>) {
        val number = (payload["orderNumber"] as? Number)?.toInt() ?: return
        val language = payload["language"]?.toString()
        val status = payload["status"]?.toString()?.trim().orEmpty()
        val branch = payload["branch"]?.toString()?.trim().orEmpty()
        val etaMillis = (payload["etaMillis"] as? Number)?.toLong()
        val progress = ((payload["progress"] as? Number)?.toDouble() ?: 0.0)
            .coerceIn(0.0, 1.0)
        val eta = etaMillis?.let {
            SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(it))
        }
        val text = listOfNotNull(
            status.ifEmpty { localizedString(language, R.string.order_notification_updating) },
            eta?.let { localizedString(language, R.string.order_notification_eta, it) },
        ).joinToString(" · ")
        val openIntent = Intent(
            Intent.ACTION_VIEW,
            Uri.parse("bulka://orders"),
            this,
            MainActivity::class.java,
        ).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pendingIntent = PendingIntent.getActivity(
            this,
            orderNotificationId,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, orderNotificationChannel)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }
        val publicBuilder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, orderNotificationChannel)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }
        val publicVersion = publicBuilder
            .setSmallIcon(R.drawable.ic_order_status)
            .setColor(Color.rgb(109, 51, 23))
            .setContentTitle(localizedString(language, R.string.order_notification_private_title))
            .setContentText(localizedString(language, R.string.order_notification_private_body))
            .setContentIntent(pendingIntent)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setOnlyAlertOnce(true)
            .build()
        val notification = builder
            .setSmallIcon(R.drawable.ic_order_status)
            .setColor(Color.rgb(109, 51, 23))
            .setContentTitle(localizedString(language, R.string.order_notification_title, number))
            .setContentText(text)
            .setContentIntent(pendingIntent)
            .setCategory(Notification.CATEGORY_PROGRESS)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .setPublicVersion(publicVersion)
            .setOnlyAlertOnce(true)
            .setOngoing(true)
            .setAutoCancel(false)
            .setProgress(100, (progress * 100).toInt(), false)
            .also { if (branch.isNotEmpty()) it.setSubText(branch) }
            .build()
        getSystemService(NotificationManager::class.java)
            .notify(orderNotificationId, notification)
    }

    private fun localizedString(language: String?, resourceId: Int, vararg args: Any): String {
        val languageTag = when (language?.lowercase(Locale.ROOT)) {
            "kk", "kz" -> "kk"
            "en" -> "en"
            else -> "ru"
        }
        val configuration = Configuration(resources.configuration).apply {
            setLocale(Locale.forLanguageTag(languageTag))
        }
        return createConfigurationContext(configuration).getString(resourceId, *args)
    }
}
