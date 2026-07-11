package com.bulka.bonus

import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import android.os.Bundle
import io.flutter.embedding.android.FlutterActivity

class MainActivity : FlutterActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(
                NotificationChannel(
                    "bulka_bonus_notifications",
                    "Уведомления Bulka",
                    NotificationManager.IMPORTANCE_HIGH,
                ).apply {
                    description = "Акции, бонусы и статус заказов"
                },
            )
        }
    }
}
