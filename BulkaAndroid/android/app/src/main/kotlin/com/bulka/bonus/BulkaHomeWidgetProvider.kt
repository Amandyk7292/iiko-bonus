package com.bulka.bonus

import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.SharedPreferences
import android.net.Uri
import android.view.View
import android.widget.RemoteViews
import es.antonborri.home_widget.HomeWidgetLaunchIntent
import es.antonborri.home_widget.HomeWidgetProvider
import java.text.NumberFormat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

class BulkaHomeWidgetProvider : HomeWidgetProvider() {
    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray,
        widgetData: SharedPreferences,
    ) {
        appWidgetIds.forEach { widgetId ->
            val signedIn = widgetData.getBoolean("widget_is_signed_in", false)
            val balance = (widgetData.all["widget_balance"] as? Number)?.toDouble() ?: 0.0
            val tier = widgetData.getString("widget_tier", null).orEmpty()
            val orderNumber = (widgetData.all["widget_order_number"] as? Number)?.toInt()
            val status = widgetData.getString("widget_delivery_status", null)
                ?.takeUnless { it == "unassigned" }
                ?: widgetData.getString("widget_order_status", null)
            val eta = widgetData.getString("widget_order_eta", null)

            val views = RemoteViews(context.packageName, R.layout.bulka_home_widget).apply {
                setViewVisibility(
                    R.id.widget_signed_in,
                    if (signedIn) View.VISIBLE else View.GONE,
                )
                setViewVisibility(
                    R.id.widget_signed_out,
                    if (signedIn) View.GONE else View.VISIBLE,
                )
                setTextViewText(R.id.widget_balance, formatBalance(balance))
                setTextViewText(
                    R.id.widget_tier,
                    tier.ifBlank { context.getString(R.string.widget_loyalty) },
                )

                val hasOrder = signedIn && orderNumber != null
                setViewVisibility(
                    R.id.widget_order,
                    if (hasOrder) View.VISIBLE else View.GONE,
                )
                setViewVisibility(
                    R.id.widget_no_order,
                    if (signedIn && !hasOrder) View.VISIBLE else View.GONE,
                )
                if (hasOrder) {
                    setTextViewText(
                        R.id.widget_order_title,
                        context.getString(R.string.widget_order_number, orderNumber),
                    )
                    val statusText = localizedStatus(context, status)
                    val etaText = formatEta(eta)
                    setTextViewText(
                        R.id.widget_order_status,
                        if (etaText == null) statusText else context.getString(
                            R.string.widget_status_with_eta,
                            statusText,
                            etaText,
                        ),
                    )
                }

                val rootUri = if (hasOrder) "bulka://orders" else "bulka://bonus"
                setOnClickPendingIntent(
                    R.id.widget_container,
                    HomeWidgetLaunchIntent.getActivity(
                        context,
                        MainActivity::class.java,
                        Uri.parse(rootUri),
                    ),
                )
                setOnClickPendingIntent(
                    R.id.widget_order,
                    HomeWidgetLaunchIntent.getActivity(
                        context,
                        MainActivity::class.java,
                        Uri.parse("bulka://orders"),
                    ),
                )

                val accessibilityText = when {
                    !signedIn -> context.getString(R.string.widget_accessibility_signed_out)
                    hasOrder -> context.getString(
                        R.string.widget_accessibility_order,
                        formatBalance(balance),
                        orderNumber,
                        localizedStatus(context, status),
                    )
                    else -> context.getString(
                        R.string.widget_accessibility_balance,
                        formatBalance(balance),
                    )
                }
                setContentDescription(R.id.widget_container, accessibilityText)
            }
            appWidgetManager.updateAppWidget(widgetId, views)
        }
    }

    private fun formatBalance(value: Double): String {
        val formatter = NumberFormat.getNumberInstance(Locale.getDefault()).apply {
            maximumFractionDigits = if (value % 1.0 == 0.0) 0 else 2
            minimumFractionDigits = 0
        }
        return "${formatter.format(value)} ₸"
    }

    private fun formatEta(raw: String?): String? {
        if (raw.isNullOrBlank()) return null
        return runCatching {
            val normalized = if (raw.endsWith("Z")) {
                raw.dropLast(1) + "+0000"
            } else {
                raw.replace(Regex("([+-]\\d{2}):(\\d{2})$"), "$1$2")
            }
            val input = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSZ", Locale.US).apply {
                timeZone = TimeZone.getTimeZone("UTC")
            }
            val parsed: Date = input.parse(normalized) ?: return null
            SimpleDateFormat("HH:mm", Locale.getDefault()).format(parsed)
        }.getOrNull()
    }

    private fun localizedStatus(context: Context, raw: String?): String {
        val resource = when (raw?.lowercase(Locale.US)) {
            "created", "new", "payment_pending" -> R.string.widget_status_received
            "paid", "accepted", "confirmed", "queued" -> R.string.widget_status_confirmed
            "preparing", "cooking" -> R.string.widget_status_preparing
            "ready", "ready_for_pickup" -> R.string.widget_status_ready
            "handed_over", "picked_up" -> R.string.widget_status_handed_over
            "on_the_way", "in_transit" -> R.string.widget_status_on_the_way
            "delivered", "completed" -> R.string.widget_status_delivered
            "cancelled", "canceled" -> R.string.widget_status_cancelled
            else -> R.string.widget_status_active
        }
        return context.getString(resource)
    }
}
